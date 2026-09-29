"""Núcleo del módulo de coberturas de PT.

Lee el MM_Supply (exportación de ABAS / Power BI) y construye, para cada
producto terminado activo, los datos necesarios para proyectar su stock a
12 meses: stock, previsión, pedidos, entradas (OF y propuestas), línea,
parámetros y clase ABC. La evaluación del semáforo está en `evaluate()` y
tiene su gemela en static/core.js (el navegador la usa para cambiar de
escenario sin volver a pedir datos al servidor).
"""
from __future__ import annotations

import calendar
import datetime as dt
import re

H = 12  # horizonte en meses
HMIN, FMIN, FMAX = 6, 0.5, 1.5  # acierto: meses mínimos de historia y límites del factor de sesgo
SHEETS = ["MM_Art", "MM_TLY", "MM_Stocks", "MM_Vtas", "MM_PedVentas", "MM_Prev", "MM_PROP", "MM_OF", "MM_Maq"]
MESES = {"ene": 0, "feb": 1, "mar": 2, "abr": 3, "may": 4, "jun": 5, "jul": 6, "ago": 7, "sep": 8, "oct": 9, "nov": 10, "dic": 11}


class DataError(ValueError):
    """Error de formato del fichero, con un mensaje para el usuario."""


# ---------------------------------------------------------------- lectura
def read_workbook(path: str) -> dict[str, list[list]]:
    """Devuelve {hoja: filas} con las hojas necesarias. Usa calamine (rápido)
    y, si no está disponible, openpyxl."""
    rows: dict[str, list[list]] = {}
    try:
        from python_calamine import CalamineWorkbook

        wb = CalamineWorkbook.from_path(path)
        names = set(wb.sheet_names)
        for n in SHEETS:
            if n in names:
                rows[n] = wb.get_sheet_by_name(n).to_python()
    except ImportError:
        import openpyxl

        wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
        for n in SHEETS:
            if n in wb.sheetnames:
                rows[n] = [list(r) for r in wb[n].iter_rows(values_only=True)]
    missing = [n for n in SHEETS if n not in rows]
    if missing:
        raise DataError("Faltan hojas en el fichero: " + ", ".join(missing))
    return rows


# ---------------------------------------------------------------- utilidades
def _norm(v) -> str:
    return "" if v is None else str(v).strip()


def _code(v) -> str:
    if v is None or v == "":
        return ""
    if isinstance(v, bool):
        return ""
    if isinstance(v, (int, float)):
        return str(int(round(v))).zfill(12)
    t = str(v).strip()
    return t.zfill(12) if re.fullmatch(r"\d{1,11}", t) else t


def _num(v) -> float:
    if v is None or v == "" or isinstance(v, bool):
        return 0.0
    if isinstance(v, (int, float)):
        return float(v)
    t = str(v).strip().replace(".", "").replace(",", ".")
    try:
        return float(t)
    except ValueError:
        return 0.0


def _date(v):
    if isinstance(v, dt.datetime):
        return v.date()
    if isinstance(v, dt.date):
        return v
    if isinstance(v, (int, float)) and not isinstance(v, bool) and v > 20000:
        return (dt.datetime(1899, 12, 30) + dt.timedelta(days=float(v))).date()
    if isinstance(v, str) and v.strip():
        for f in ("%Y-%m-%d", "%d/%m/%Y", "%Y-%m-%dT%H:%M:%S"):
            try:
                return dt.datetime.strptime(v.strip()[:19], f).date()
            except ValueError:
                pass
    return None


def _true(v) -> bool:
    return v is True or _norm(v).upper() in ("TRUE", "VERDADERO", "1", "SÍ", "SI")


def _clean_header(h) -> str:
    t = _norm(h)
    t = re.sub(r"^.*\[", "", t)
    return t.rstrip("]").lower()


class _Table:
    def __init__(self, rows, must_have: str, sheet: str):
        self.sheet = sheet
        for i, r in enumerate(rows[:12]):
            hs = [_clean_header(h) for h in (r or [])]
            if must_have.lower() in hs:
                self.idx = {}
                for j, h in enumerate(hs):
                    if h and h not in self.idx:
                        self.idx[h] = j
                self.header_row = i
                self.data = rows[i + 1:]
                return
        raise DataError(f'La hoja {sheet} no tiene la columna "{must_have}"')

    def col(self, name: str) -> int:
        j = self.idx.get(name.lower())
        if j is None:
            raise DataError(f'La hoja {self.sheet} no tiene la columna "{name}"')
        return j

    def opt(self, *names):
        for n in names:
            j = self.idx.get(n.lower())
            if j is not None:
                return j
        return None


def _get(r, j):
    return r[j] if j is not None and j < len(r) else None


# ---------------------------------------------------------------- parseo
def _ym(y: int, m0: int) -> str:
    """Mes m0 (base 0, puede pasar de 11) del año y, como 'MM/AAAA'."""
    return f"{m0 % 12 + 1:02d}/{y + m0 // 12}"


def _resto(p0: float, vendido: float, dq: int, dm: int) -> int:
    """Resto de previsión del mes en curso: la menor entre lo que falta para llegar a la
    previsión y la parte proporcional de los dq días naturales que quedan de dm."""
    return max(0, min(round(p0 - max(0.0, vendido)), round(p0 * dq / dm)))


def vigentes(cover: dict[str, set[int]], base_y: int, base_m: int, n: int = 12) -> list[str]:
    """Versión vigente de cada mes cerrado (-n..-1): la más reciente que cubre el mes y cuyo
    trimestre empezó en o antes de él (2026Q2 cubre enero, pero enero se toma de 2026Q1)."""
    def inicio(v: str) -> int:
        return (int(v[:4]) - base_y) * 12 + 3 * (int(v[5]) - 1) - base_m

    return [next((v for v in sorted(cover, reverse=True) if m in cover[v] and inicio(v) <= m), "") for m in range(-n, 0)]


def acierto(refs: list[dict], dq: int, dm: int) -> None:
    """Factor de sesgo (venta ÷ previsión vigente) y error medio de los 12 meses cerrados,
    propios con HMIN meses de historia o, si no, de su grupo mandante × ABC."""
    def err(v, p):
        return sum(abs(a - b) for a, b in zip(v, p))

    grp: dict[tuple, list[float]] = {}
    for r in refs:
        r["hm"] = sum(1 for x in r["hp"] if x > 0)
        if r["hm"] >= HMIN:
            g = grp.setdefault((r["md"], r["abc"]), [0.0, 0.0, 0.0])
            g[0] += sum(r["vt"])
            g[1] += sum(r["hp"])
            g[2] += err(r["vt"], r["hp"])
    for r in refs:
        g = grp.get((r["md"], r["abc"]))
        sv, sp = sum(r["vt"]), sum(r["hp"])
        if r["hm"] >= HMIN and sp > 0:
            fc, fo = sv / sp, "ref"
        elif g and g[1] > 0:
            fc, fo = g[0] / g[1], "grupo"
        else:
            fc, fo = 1.0, "sin"
        if r["hm"] >= HMIN and sv > 0:
            er, eo = err(r["vt"], r["hp"]) / sv, "ref"
        elif g and g[0] > 0:
            er, eo = g[2] / g[0], "grupo"
        else:
            er, eo = None, "sin"
        fc = round(min(FMAX, max(FMIN, fc)), 3)
        r.update(fc=fc, fo=fo, er=None if er is None else round(er, 3), eo=eo,
                 pvc=[round(x * fc) for x in r["pv"]], pv0rc=_resto(r["pv"][0] * fc, r["v0"], dq, dm))


def parse(rows: dict[str, list[list]], today: dt.date) -> dict:
    base_y, base_m = today.year, today.month - 1

    def midx(d: dt.date) -> int:
        return (d.year - base_y) * 12 + (d.month - 1 - base_m)

    warn: list[str] = []

    # Maestro
    ta = _Table(rows["MM_Art"], "Nº Artículo", "MM_Art")
    c = {n: ta.col(n) for n in ["Nº Artículo", "Artículo", "yceestado", "ybinactivo", "yartextin", "ymarca", "ycefamilia",
                                  "Grupo Planificacion", "T.Lote", "minbsmge", "Precio Mixto", "Codigo Sucesor"]}
    A = {}
    for r in ta.data:
        k = _code(_get(r, c["Nº Artículo"]))
        if not k:
            continue
        A[k] = dict(
            name=_norm(_get(r, c["Artículo"])), estado=_norm(_get(r, c["yceestado"])),
            inact=_norm(_get(r, c["ybinactivo"])) == "Sí", ext=_norm(_get(r, c["yartextin"])) == "Sí",
            marca=_norm(_get(r, c["ymarca"])) or _norm(_get(r, c["ycefamilia"])),
            gp=_norm(_get(r, c["Grupo Planificacion"])), lote=_num(_get(r, c["T.Lote"])), min=_num(_get(r, c["minbsmge"])),
            precio=_num(_get(r, c["Precio Mixto"])), suc=_code(_get(r, c["Codigo Sucesor"])),
        )
    if not A:
        raise DataError("MM_Art no tiene artículos")

    # Parámetros de Yunsey
    tt = _Table(rows["MM_TLY"], "Tamaño de lote", "MM_TLY")
    jl, jm = tt.col("Tamaño de lote"), tt.col("Stock mínimo")
    TLY = {}
    for r in tt.data:
        k = _code(_get(r, 0))
        if k:
            TLY[k] = (_num(_get(r, jl)), _num(_get(r, jm)))

    # Stock (suma de ambos mandantes)
    ts = _Table(rows["MM_Stocks"], "Nº Articulo", "MM_Stocks")
    jk, jq = ts.col("Nº Articulo"), ts.col("SumStock_actual")
    ST: dict[str, float] = {}
    for r in ts.data:
        k = _code(_get(r, jk))
        if k:
            ST[k] = ST.get(k, 0.0) + _num(_get(r, jq))

    # Previsión operativa: cada mes sale de la versión más reciente que lo cubre
    # (p. ej. el mes en curso de 2026Q3 y los siguientes de 2026Q4).
    tp = _Table(rows["MM_Prev"], "IDPrev", "MM_Prev")
    iR, iV, iQ, iF, iM = tp.col("Referencia"), tp.col("IDPrev"), tp.col("Valor"), tp.col("Fecha"), tp.opt("Mandante")
    pr = []  # (versión, ref, mes, fila)
    cover: dict[str, set[int]] = {}
    for r in tp.data:
        v = _norm(_get(r, iV))
        if not re.fullmatch(r"\d{4}Q\d", v):
            continue
        k, d = _code(_get(r, iR)), _date(_get(r, iF))
        if not k or not d:
            continue
        mi = midx(d)
        cover.setdefault(v, set()).add(mi)
        pr.append((v, k, mi, r))
    ver = max(cover, default="")
    if not ver:
        warn.append("MM_Prev no tiene ninguna versión de previsión")
    src = [next((v for v in sorted(cover, reverse=True) if m in cover[v]), "") for m in range(H)]
    if ver and not all(src):
        warn.append("Hay meses sin previsión en ninguna versión: " + ", ".join(_ym(base_y, base_m + m) for m in range(H) if not src[m]))
    hsrc = vigentes(cover, base_y, base_m)
    HP: dict[str, list[float]] = {}  # previsión vigente de los 12 meses cerrados
    PREV: dict[str, list[float]] = {}
    MAND: dict[str, str] = {}
    for v, k, mi, r in pr:
        if -12 <= mi < 0 and hsrc[mi + 12] == v:
            HP.setdefault(k, [0.0] * 12)[mi + 12] += _num(_get(r, iQ))
        if not (0 <= mi < H and src[mi] == v):
            continue
        PREV.setdefault(k, [0.0] * H)[mi] += _num(_get(r, iQ))
        if iM is not None and _get(r, iM) and (k not in MAND or v == ver):
            MAND[k] = _norm(_get(r, iM))

    # Ventas (tabla dinámica con años en la fila superior)
    vr = rows["MM_Vtas"]
    tv = _Table(vr, "Nº Articulo", "MM_Vtas")
    hdr = vr[tv.header_row]
    yrs = vr[tv.header_row - 1] if tv.header_row > 0 else []
    vcols, cy = [], None
    for j in range(2, len(hdr)):
        yv = _norm(_get(yrs, j))
        if re.fullmatch(r"\d{4}(\.0)?", yv):
            cy = int(float(yv))
        mm = MESES.get(_norm(hdr[j]).lower())
        if mm is not None and cy:
            vcols.append((j, (cy - base_y) * 12 + (mm - base_m)))
    VT: dict[str, list[float]] = {}
    for r in tv.data:
        k = _code(_get(r, 0))
        if not k or k == "Total general":
            continue
        a = [0.0] * 13
        for j, mi in vcols:
            if -12 <= mi <= 0:
                a[mi + 12] += _num(_get(r, j))
        VT[k] = a

    # Pedidos pendientes
    tpv = _Table(rows["MM_PedVentas"], "Nº Articulo", "MM_PedVentas")
    jd = tpv.opt("Fecha envío", "Fecha envio")
    jq = tpv.col("SumCantidad_pdte_entrega")
    PED: dict[str, list[float]] = {}
    ATR: dict[str, float] = {}
    for r in tpv.data:
        k = _code(_get(r, 0))
        q = _num(_get(r, jq))
        if not k or not q:
            continue
        d = _date(_get(r, jd))
        if d and d < today:
            ATR[k] = ATR.get(k, 0.0) + q
        mi = max(0, midx(d)) if d else 0
        if mi < H:
            PED.setdefault(k, [0.0] * H)[mi] += q

    # Entradas: OF abiertas y propuestas del MRP
    E: dict[str, list[dict]] = {}
    to = _Table(rows["MM_OF"], "num9", "MM_OF")
    jn, jc, jt, jqo, js = to.col("num9"), to.col("nummer"), to.col("tterm"), to.col("mge"), to.opt("such")
    for r in to.data:
        k = _code(_get(r, jc))
        q = _num(_get(r, jqo))
        if not k or not q:
            continue
        d = _date(_get(r, jt))
        mi = max(0, midx(d)) if d else 0
        if mi >= H:
            continue
        E.setdefault(k, []).append(dict(t="OF", q=round(q), m=mi, d=d.isoformat() if d else "", late=bool(d and d < today),
                                        id=_norm(_get(r, jn)), mq=_norm(_get(r, js))))
    tr = _Table(rows["MM_PROP"], "nummer", "MM_PROP")
    jc, j9, jw, jqp, jf = tr.col("nummer"), tr.col("num9"), tr.col("wtterm"), tr.col("mge"), tr.col("fix")
    for r in tr.data:
        k = _code(_get(r, jc))
        if not k or _norm(_get(r, j9)):  # con nº de OF: ya está en MM_OF
            continue
        q = _num(_get(r, jqp))
        if not q:
            continue
        d = _date(_get(r, jw))
        mi = max(0, midx(d)) if d else 0
        if mi >= H:
            continue
        E.setdefault(k, []).append(dict(t="PF" if _true(_get(r, jf)) else "P", q=round(q), m=mi,
                                        d=d.isoformat() if d else "", late=bool(d and d < today)))

    # Líneas (grupo de máquina)
    LIN, LNAME = {}, {}
    for r in rows["MM_Maq"][1:]:
        k = _code(_get(r, 0))
        g = _norm(_get(r, 2))
        if k and g:
            LIN[k] = g
            if _norm(_get(r, 3)):
                LNAME[g] = _norm(_get(r, 3))

    # Resto de previsión del mes en curso: la menor entre lo que falta para llegar a la
    # previsión y la parte proporcional de los días naturales que quedan (hoy incluido)
    dias_mes = calendar.monthrange(today.year, today.month)[1]
    dias_quedan = dias_mes - today.day + 1

    # Universo: PT activos con alguna señal
    refs = []
    for k, a in A.items():
        if a["estado"] != "Producto terminado" or a["inact"]:
            continue
        st, pv, pd, en, vt = ST.get(k, 0.0), PREV.get(k), PED.get(k), E.get(k), VT.get(k)
        if not (st > 0 or (pv and any(x > 0 for x in pv)) or (pd and any(x > 0 for x in pd)) or en or (vt and any(x > 0 for x in vt))):
            continue
        mand = MAND.get(k) or ("Yunsey" if k in TLY else "Belloch")
        lote, mn = TLY[k] if (mand == "Yunsey" and k in TLY) else (a["lote"], a["min"])
        prev = [round(x) for x in pv] if pv else [0] * H
        v0 = vt[12] if vt else 0.0
        refs.append(dict(
            k=k, n=a["name"], md=mand, mc=a["marca"], gp=a["gp"], ln=LIN.get(k, ""), ext=a["ext"], sc=a["suc"],
            st=round(st), mn=round(mn), lt=round(lote), pr=round(a["precio"], 2),
            pv=prev, pv0r=_resto(prev[0], v0, dias_quedan, dias_mes), hp=[round(x) for x in HP.get(k, [0.0] * 12)], pd=[round(x) for x in pd] if pd else [0] * H,
            at=round(ATR.get(k, 0.0)), en=sorted(en or [], key=lambda e: e["d"]),
            vt=[round(x) for x in vt[:12]] if vt else [0] * 12, v0=round(v0),
        ))

    # ABC por mandante: % acumulado de la previsión de los próximos 12 meses
    for md in ("Belloch", "Yunsey"):
        g = sorted(((r, sum(r["pv"])) for r in refs if r["md"] == md and r["gp"] != "Bajo Pedido"), key=lambda x: -x[1])
        tot = sum(t for _, t in g) or 1
        cum = 0.0
        for r, t in g:
            cum += t
            p = cum / tot
            r["abc"] = "D" if t <= 0 else "A" if p < 0.45 else "B" if p < 0.80 else "C" if p < 0.95 else "D"
    for r in refs:
        if r["gp"] == "Bajo Pedido":
            r["abc"] = "NA"
        r.setdefault("abc", "D")
    acierto(refs, dias_quedan, dias_mes)

    refs.sort(key=lambda r: r["k"])
    meta = dict(base=f"{base_y}-{base_m + 1:02d}", hoy=today.isoformat(), version=ver, prev_src=src, hist_src=hsrc, dias=[dias_quedan, dias_mes], n=len(refs), lineas=LNAME, warn=warn)
    return {"meta": meta, "refs": refs}


# ---------------------------------------------------------------- evaluación
def project(r: dict, esc: str, pv: str = "T"):
    """pv: "T" previsión tal cual, "C" corregida por el sesgo (si la carga la trae)."""
    def inc(t):
        return t == "OF" or (esc != "OF" and t == "PF") or (esc == "ALL" and t == "P")

    p, p0 = (r["pvc"], r["pv0rc"]) if pv == "C" and "pvc" in r else (r["pv"], r["pv0r"])
    dem = [max(p0 if m == 0 else p[m], r["pd"][m]) for m in range(H)]
    ent = [0] * H
    for e in r["en"]:
        if inc(e["t"]):
            ent[e["m"]] += e["q"]
    stk, s = [], r["st"]
    for m in range(H):
        s = s - dem[m] + ent[m]
        stk.append(s)
    return {"dem": dem, "ent": ent, "stk": stk}


def evaluate(r: dict, horizonte: int = 3, escenario: str = "ALL", prevision: str = "T") -> dict:
    hz = horizonte
    allp, ofp = project(r, escenario, prevision), project(r, "OF", prevision)

    def first_below(p, lim):
        for m in range(H):
            if p["stk"][m] < lim:
                return m
        return -1

    rot = first_below(allp, 0)
    bmin = first_below(allp, r["mn"]) if r["mn"] > 0 else -1
    rot_of = first_below(ofp, 0)
    bmin_of = first_below(ofp, r["mn"]) if r["mn"] > 0 else -1
    d12 = sum(allp["dem"])
    late_of = any(e["t"] == "OF" and e["late"] for e in r["en"])
    has_p = any(e["t"] == "P" and e["m"] < hz for e in r["en"])
    sem, why = "verde", "Cubierto en el horizonte"
    if d12 <= 0 and r["st"] >= 0:
        sem, why = "gris", "Sin demanda prevista" if r["st"] > 0 else "Sin demanda ni stock"
    elif 0 <= rot < hz:
        sem = "rojo"
        if rot == 0 and r["at"] > r["st"]:
            why = "Pedidos atrasados por encima del stock"
        elif rot == 0:
            why = "Rotura este mes"
        else:
            why = f"Rotura en {rot} {'mes' if rot == 1 else 'meses'}"
    elif 0 <= bmin < hz:
        sem, why = "naranja", "Por debajo del stock mínimo"
    elif ((0 <= rot_of < hz) or (0 <= bmin_of < hz)) and has_p and escenario == "ALL":
        sem, why = "amarillo", "Depende de propuestas sin fijar"
    if late_of and sem == "verde":
        sem, why = "amarillo", "OF con fecha pasada"
    return {"sem": sem, "why": why, "rot": rot}
