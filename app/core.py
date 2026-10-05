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
LANZ_MESES, ALTA_MESES = 9, 4
# ABC y parámetros por clase (A, B, C, D); se cambian desde Datos → Criterios
ABC_DEF = dict(cortes=[45, 80, 95], freq={"Belloch": [12, 6, 4, 2], "Yunsey": [6, 4, 2, 1]},
               ss={"Belloch": [75, 75, 50, 0], "Yunsey": [75, 75, 50, 0]})
ABC_VIDA, ABC_MIN = 12, 3  # meses de venta para un ABC definitivo / mínimos para anualizarla  # porfolio: ventana de lanzamientos y antigüedad máxima de un "alta nueva"
EXCESO_DEF = {"Belloch": 6, "Yunsey": 12}  # exceso: stock para más de N meses de demanda (provisional hasta el módulo de stock mínimo)
SHEETS = ["MM_Art", "MM_TLY", "MM_Stocks", "MM_Vtas", "MM_PedVentas", "MM_Prev", "MM_PROP", "MM_OF", "MM_Maq"]
SHEETS_OPC = ["MM_PedCompras", "Escandallos"]  # si faltan, la carga sigue (avisa): PT fabricados fuera sin entradas ni ZT
# Pedidos de compra entre empresas del grupo: son producción propia que ya entra por la OF de Belloch
PROV_INTRAGRUPO = ("LABORATORIOS BELLOCH",)
FIRMES = ("OF", "PC")  # entradas firmes: cuentan en todos los escenarios (OF y pedidos de compra a proveedor)
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
        for n in SHEETS + SHEETS_OPC:
            if n in names:
                rows[n] = wb.get_sheet_by_name(n).to_python()
    except ImportError:
        import openpyxl

        wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
        for n in SHEETS + SHEETS_OPC:
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


def _id(v) -> str:
    """Número de documento (pedido, OF) como texto: sin el «.0» que añade Excel a los números."""
    if isinstance(v, float) and v.is_integer():
        return str(int(v))
    return _norm(v)


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
ATR_DIAS = 30  # pedidos atrasados: hasta 30 días cuentan (los de meses anteriores, encima de la previsión); más viejos, a revisar en ABAS
PLAZO_DIAS = 21  # plazo de fabricación (3 semanas): una propuesta sin fijar no puede entrar antes de hoy + PLAZO_DIAS

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


def _inicio(v: str, base_y: int, base_m: int) -> int:
    """Primer mes (índice respecto al mes en curso) del trimestre de la versión AAAAQn."""
    return (int(v[:4]) - base_y) * 12 + 3 * (int(v[5]) - 1) - base_m


def acierto_versiones(items, cover, sales, amb, base_y, base_m, meses_venta: set[int] | None = None) -> list[dict]:
    """Error de cada versión contra la venta real, por (versión, marca): meses cerrados que cubre la
    versión desde el inicio de su trimestre, solo referencias del ámbito con filas en ese periodo.
    items: (versión, ref, mes, cantidad); sales: {ref: {mes: uds}}; amb: {ref: marca};
    meses_venta: meses que trae MM_Vtas (los que no trae no cuentan como venta 0)."""
    ini = {v: _inicio(v, base_y, base_m) for v in cover}
    ph: dict[tuple, dict] = {}
    for v, k, mi, q in items:
        if k in amb and ini[v] <= mi < 0:
            d = ph.setdefault((v, k), {})
            d[mi] = d.get(mi, 0.0) + q
    acc: dict[tuple, dict] = {}
    for (v, k), d in ph.items():
        meses = sorted(m for m in cover[v] if ini[v] <= m < 0 and (meses_venta is None or m in meses_venta))
        a = acc.setdefault((v, amb[k]), dict(v=v, mc=amb[k], e=0.0, s=0.0, p=0.0, n=0, ms=set()))
        a["n"] += 1
        for m in meses:
            p, s = d.get(m, 0.0), sales.get(k, {}).get(m, 0.0)
            a["e"] += abs(s - p)
            a["s"] += s
            a["p"] += p
            a["ms"].add(m)
    return [dict(v=a["v"], mc=a["mc"], e=round(a["e"]), s=round(a["s"]), p=round(a["p"]), n=a["n"], m=len(a["ms"]))
            for _, a in sorted(acc.items())]


def acierto(refs: list[dict], dq: int, dm: int) -> None:
    """Factor de sesgo (venta ÷ previsión vigente, en los meses que tenían previsión) y error
    medio de los 12 meses cerrados, propios con HMIN meses de historia o, si no, de su grupo
    mandante × ABC."""
    def err(v, p):
        return sum(abs(a - b) for a, b in zip(v, p))

    def venta_con_prev(r):  # el factor compara mes con mes: solo la venta de los meses que tenían previsión
        return sum(v for v, p in zip(r["vt"], r["hp"]) if p > 0)

    grp: dict[tuple, list[float]] = {}
    for r in refs:
        r["hm"] = sum(1 for x in r["hp"] if x > 0)
        if r["hm"] >= HMIN:
            g = grp.setdefault((r["md"], r["abc"]), [0.0, 0.0, 0.0, 0.0])
            g[0] += sum(r["vt"])
            g[1] += sum(r["hp"])
            g[2] += err(r["vt"], r["hp"])
            g[3] += venta_con_prev(r)
    for r in refs:
        g = grp.get((r["md"], r["abc"]))
        sv, sp = sum(r["vt"]), sum(r["hp"])
        if r["hm"] >= HMIN and sp > 0:
            fc, fo = venta_con_prev(r) / sp, "ref"
        elif g and g[1] > 0:
            fc, fo = g[3] / g[1], "grupo"
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


def clasificar(refs: list[dict], cortes: list[int]) -> None:
    """ABC por mandante con Pareto sobre la venta de los 12 meses cerrados. Con menos de ABC_VIDA
    meses desde la primera venta se anualiza la venta media; con menos de ABC_MIN se usa la previsión
    de 12 meses (ABC provisional). Bajo pedido: NA. Cada referencia queda en la clase en la que
    empieza (la que cruza un corte no salta a la siguiente)."""
    for r in refs:
        fv = r.get("fv")
        if "fv" not in r:  # carga antigua: la primera venta se deduce de los 12 meses guardados
            fv = next((i - 12 for i, x in enumerate(r["vt"]) if x > 0), None)
        n = -fv if fv is not None else 0
        if n >= ABC_VIDA:
            m, x = sum(r["vt"]), "venta"
        elif n >= ABC_MIN:
            m, x = sum(r["vt"][12 - n:]) / n * 12, "anual"
        else:
            m, x = sum(r["pv"]), "prev"
        r.update(abcm=round(m), abcx=x, abcn=n, abcp=x != "venta")
    a, b, c = (p / 100 for p in cortes)
    for md in {r["md"] for r in refs}:
        g = sorted((r for r in refs if r["md"] == md and r["gp"] != "Bajo Pedido"), key=lambda r: (-r["abcm"], r["k"]))
        tot = sum(r["abcm"] for r in g) or 1
        cum = 0.0
        for r in g:
            p = cum / tot
            cum += r["abcm"]
            r["abc"] = "D" if r["abcm"] <= 0 else "A" if p < a else "B" if p < b else "C" if p < c else "D"
    for r in refs:
        if r["gp"] == "Bajo Pedido":
            r["abc"] = "NA"


def recalcular(ds: dict, cortes: list[int]) -> dict:
    """Vuelve a clasificar el ABC de una carga guardada con otros cortes, y con él el acierto de la
    previsión (que usa el grupo mandante × ABC), sin volver a leer el Excel."""
    clasificar(ds["refs"], cortes)
    if ds["refs"] and "hp" in ds["refs"][0] and ds["meta"].get("dias"):
        acierto(ds["refs"], *ds["meta"]["dias"])
    return ds


def _hace_meses(d: dt.date, n: int) -> dt.date:
    y, m = divmod(d.year * 12 + d.month - 1 - n, 12)
    return dt.date(y, m + 1, min(d.day, calendar.monthrange(y, m + 1)[1]))


def sucesor(A: dict, k: str) -> str:
    """Sucesor de un artículo solo si existe en el maestro y no está de baja (inactivo)."""
    s = A.get(k, {}).get("suc", "")
    return s if s and s in A and not A[s]["inact"] else ""


def porfolio(A: dict, refs: list[dict], today: dt.date, base_y: int, base_m: int, *, ST, PREV, PFUT, PPAS, VL, LIN, E, TLY,
             PFUTV=frozenset(), prev: dict | None = None) -> dict:
    """Vista de porfolio: resumen del maestro, lanzamientos con su preparación, PT activos sin
    movimiento, inactivos con stock y altas/bajas frente a la carga anterior (prev = {código: nombre})."""
    en_app = {r["k"]: r for r in refs}
    pt = {k: a for k, a in A.items() if a["estado"] == "Producto terminado"}
    ex = lambda k: dict(ext=bool(A.get(k, {}).get("ext")), sc=sucesor(A, k))  # noqa: E731  a extinguir y sucesor válido
    act = {k: a for k, a in pt.items() if not a["inact"]}
    iso = lambda d: d.isoformat() if d else ""  # noqa: E731

    lanz, desde = [], _hace_meses(today, LANZ_MESES)
    for k, a in act.items():
        if not a["alta"] or a["alta"] < desde:
            continue
        r = en_app.get(k)
        yun = (r["md"] == "Yunsey") if r else k.startswith("5")
        mn = r["mn"] if r else (TLY[k][1] if yun and k in TLY else a["min"])
        lt = r["lt"] if r else (TLY[k][0] if yun and k in TLY else a["lote"])
        cs = (r["gp"] if r else a["gp"]) == "Contra Stock"
        lanz.append(dict(k=k, n=a["name"], alta=iso(a["alta"]), app=bool(r), gp=a["gp"],
                         pv=any(x > 0 for x in PREV.get(k, [])) or k in PFUTV, ln=bool(r["ln"] if r else LIN.get(k)),
                         mn=(mn > 0) if cs else None, lt=lt > 0, en=bool(E.get(k)), **ex(k)))
    lanz.sort(key=lambda x: x["alta"], reverse=True)

    fuera = []
    for k, a in act.items():
        if k in en_app:
            continue
        cat = "prev_futura" if k in PFUT else "venta_antigua" if k in VL else "prev_pasada" if k in PPAS else "nada"
        fuera.append(dict(k=k, n=a["name"], alta=iso(a["alta"]), gp=a["gp"], cat=cat, uv=_ym(base_y, base_m + VL[k]) if k in VL else "", **ex(k)))
    fuera.sort(key=lambda x: (x["cat"], x["alta"]))

    inact = sorted((dict(k=k, n=a["name"], st=round(ST.get(k, 0.0)), pr=round(a.get("precio", 0.0), 2), fina=iso(a["fina"]), **ex(k)) for k, a in pt.items()
                    if a["inact"] and ST.get(k, 0.0) > 0), key=lambda x: (-x["st"] * x["pr"], -x["st"]))

    cambios = None
    if prev is not None:
        alta_desde = _hace_meses(today, ALTA_MESES)
        entran = [dict(k=k, n=r["n"], m="alta" if A[k]["alta"] and A[k]["alta"] >= alta_desde else "vuelve", **ex(k))
                  for k, r in en_app.items() if k not in prev]
        salen = [dict(k=k, n=n, m="no_maestro" if k not in A else "no_pt" if A[k]["estado"] != "Producto terminado"
                      else "inactiva" if A[k]["inact"] else "sin_mov", **ex(k)) for k, n in prev.items() if k not in en_app]
        cambios = dict(entran=sorted(entran, key=lambda x: x["k"]), salen=sorted(salen, key=lambda x: x["k"]))

    return dict(res=dict(maestro=len(pt), activos=len(act), seguimiento=len(en_app), fuera=len(fuera)),
                lanz=lanz, fuera=fuera, inact=inact, cambios=cambios, cfg=dict(lanz=LANZ_MESES, alta=ALTA_MESES))


def parse(rows: dict[str, list[list]], today: dt.date, anterior: dict | None = None, cortes: list[int] | None = None) -> dict:
    """anterior: {código: nombre} de la carga anterior, para las altas y bajas del porfolio.
    cortes: cortes del ABC en % (por defecto ABC_DEF)."""
    base_y, base_m = today.year, today.month - 1

    def midx(d: dt.date) -> int:
        return (d.year - base_y) * 12 + (d.month - 1 - base_m)

    warn: list[str] = []

    # Maestro
    ta = _Table(rows["MM_Art"], "Nº Artículo", "MM_Art")
    c = {n: ta.col(n) for n in ["Nº Artículo", "Artículo", "yceestado", "ybinactivo", "yartextin", "ymarca", "ycefamilia",
                                  "Grupo Planificacion", "T.Lote", "Precio Mixto", "Codigo Sucesor"]}
    jalta, jina = ta.opt("yfechaalta"), ta.opt("yfechaina")
    jmin = ta.opt("mindest")  # stock mínimo (Mindestbestand); minbsmge es la cantidad mínima de pedido
    if jmin is None:
        warn.append('MM_Art no trae la columna "mindest": las referencias de Belloch quedan sin stock mínimo')
    A = {}
    for r in ta.data:
        k = _code(_get(r, c["Nº Artículo"]))
        if not k:
            continue
        A[k] = dict(
            name=_norm(_get(r, c["Artículo"])), estado=_norm(_get(r, c["yceestado"])),
            inact=_norm(_get(r, c["ybinactivo"])) == "Sí", ext=_norm(_get(r, c["yartextin"])) == "Sí",
            marca=_norm(_get(r, c["ymarca"])) or _norm(_get(r, c["ycefamilia"])),
            gp=_norm(_get(r, c["Grupo Planificacion"])), lote=_num(_get(r, c["T.Lote"])), min=_num(_get(r, jmin)),
            precio=_num(_get(r, c["Precio Mixto"])), suc=_code(_get(r, c["Codigo Sucesor"])),
            alta=_date(_get(r, jalta)), fina=_date(_get(r, jina)),
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
    iR, iV, iQ, iF = tp.col("Referencia"), tp.col("IDPrev"), tp.col("Valor"), tp.col("Fecha")
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
    PFUT, PPAS = set(), set()  # previsión > 0 más allá del horizonte / en meses pasados (cualquier versión)
    PFUTV = set()  # previsión > 0 más allá del horizonte en la versión vigente: también se sigue
    for v, k, mi, r in pr:
        if _num(_get(r, iQ)) > 0:
            (PFUT if mi >= H else PPAS if mi < 0 else set()).add(k)
            if mi >= H and v == ver:
                PFUTV.add(k)
        if -12 <= mi < 0 and hsrc[mi + 12] == v:
            HP.setdefault(k, [0.0] * 12)[mi + 12] += _num(_get(r, iQ))
        if not (0 <= mi < H and src[mi] == v):
            continue
        PREV.setdefault(k, [0.0] * H)[mi] += _num(_get(r, iQ))

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
    VALL: dict[str, dict[int, float]] = {}  # venta de todos los meses cerrados, para el acierto por versión
    VL: dict[str, int] = {}  # último mes con venta (índice respecto al mes en curso), en toda la hoja
    FV: dict[str, int] = {}  # primer mes con venta, para saber si el ABC es definitivo
    for r in tv.data:
        k = _code(_get(r, 0))
        if not k or k == "Total general":
            continue
        a = [0.0] * 13
        for j, mi in vcols:
            q = _num(_get(r, j))
            if mi < 0:
                d = VALL.setdefault(k, {})
                d[mi] = d.get(mi, 0.0) + q
            if -12 <= mi <= 0:
                a[mi + 12] += q
            if q > 0 and mi <= 0:
                VL[k] = max(VL.get(k, mi), mi)
                FV[k] = min(FV.get(k, mi), mi)
        VT[k] = a

    # Pedidos pendientes
    tpv = _Table(rows["MM_PedVentas"], "Nº Articulo", "MM_PedVentas")
    jd = tpv.opt("Fecha envío", "Fecha envio")
    jq = tpv.col("SumCantidad_pdte_entrega")
    PED: dict[str, list[float]] = {}
    PDD: dict[str, list[list]] = {}  # pedidos con fecha [fecha (las pasadas, hoy), mes, cantidad]: rotura antes de cada entrada
    ATR: dict[str, float] = {}
    AB: dict[str, float] = {}  # atrasados vivos de meses anteriores: demanda que no estaba en la previsión del mes
    AO: dict[str, list[list]] = {}  # atrasados de más de ATR_DIAS días: no cuentan, se listan para revisarlos
    mes1 = today.replace(day=1)
    for r in tpv.data:
        k = _code(_get(r, 0))
        q = _num(_get(r, jq))
        if not k or not q:
            continue
        d = _date(_get(r, jd))
        if d and (today - d).days > ATR_DIAS:
            AO.setdefault(k, []).append([d.isoformat(), round(q)])
            continue
        if d and d < today:
            ATR[k] = ATR.get(k, 0.0) + q
            if d < mes1:
                AB[k] = AB.get(k, 0.0) + q
        mi = max(0, midx(d)) if d else 0
        if mi < H:
            PED.setdefault(k, [0.0] * H)[mi] += q
            PDD.setdefault(k, []).append([max(d or today, today).isoformat(), mi, round(q)])

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
    # Pedidos de compra a proveedor pendientes (PT fabricados fuera): entrada firme «PC», como una OF.
    # Los del grupo (LABORATORIOS BELLOCH) no cuentan: ya entran por la OF.
    if rows.get("MM_PedCompras"):
        tc = _Table(rows["MM_PedCompras"], "Articulo", "MM_PedCompras")
        jc, jq, jf, jp, jv = tc.col("Articulo"), tc.col("SumCantidad_Pendiente"), tc.col("Fecha Entrega"), tc.opt("Nº Pedido"), tc.opt("Nombre proveedor")
        for r in tc.data:
            k = _code(_get(r, jc))
            q = _num(_get(r, jq))
            prov = _norm(_get(r, jv))
            if k not in A or q <= 0 or any(x in prov.upper() for x in PROV_INTRAGRUPO):
                continue
            d = _date(_get(r, jf))
            mi = max(0, midx(d)) if d else 0
            if mi >= H:
                continue
            E.setdefault(k, []).append(dict(t="PC", q=round(q), m=mi, d=d.isoformat() if d else "", late=bool(d and d < today),
                                            id=_id(_get(r, jp)), pv=prov))
    else:
        warn.append("El fichero no trae la hoja MM_PedCompras: los PT fabricados por proveedores quedan sin entradas")
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
        fija = _true(_get(r, jf))
        if not fija and (not d or d < today + dt.timedelta(days=PLAZO_DIAS)):
            # sin fijar y ya no llega con el plazo de fabricación: lo antes que entraría si se lanzara hoy
            e = dict(t="P", q=round(q), d=(today + dt.timedelta(days=PLAZO_DIAS)).isoformat(), late=False, dm=d.isoformat() if d else "")
            e["m"] = midx(dt.date.fromisoformat(e["d"]))
            if e["m"] < H:
                E.setdefault(k, []).append(e)
            continue
        E.setdefault(k, []).append(dict(t="PF" if fija else "P", q=round(q), m=mi,
                                        d=d.isoformat() if d else "", late=bool(d and d < today)))

    # PT fabricados fuera: el proveedor necesita el ZT (semiterminado) que fabricamos nosotros. Del escandallo,
    # los ZT de cada PT con pedido de compra y cuántos lleva cada PT (QNivelPT); su stock, OF y propuestas ya están leídos
    ZTS: dict[str, dict[str, float]] = {}
    con_pc = {k for k, es in E.items() if any(e["t"] == "PC" for e in es)}
    if rows.get("Escandallos") and con_pc:
        tb = _Table(rows["Escandallos"], "Nº Articulo", "Escandallos")
        jk, jz, jzq = tb.col("Nº Articulo"), tb.col("NivelPT"), tb.col("QNivelPT")
        for r in tb.data:
            k, z = _code(_get(r, jk)), _code(_get(r, jz))
            if k in con_pc and z and z != k and (z.endswith("ZT") or A.get(z, {}).get("estado") == "Semiterminado"):
                ZTS.setdefault(k, {})[z] = _num(_get(r, jzq)) or 1.0
    elif con_pc:
        warn.append("El fichero no trae la hoja Escandallos: no se comprueba el ZT de los PT fabricados fuera")

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
    # f: parte de lo que queda del mes que habrá pasado cuando llegue la entrada (para la rotura antes de la entrada)
    for es in E.values():
        for e in es:
            if e["m"] == 0 and e["d"] > today.isoformat():
                e["f"] = round((dt.date.fromisoformat(e["d"]) - today).days / dias_quedan, 3)

    # Universo: PT activos con alguna señal, más los lanzamientos (altas de los últimos LANZ_MESES
    # meses) aunque todavía no tengan nada, y los que solo tienen previsión más allá del horizonte
    refs, lanz_desde = [], _hace_meses(today, LANZ_MESES)
    for k, a in A.items():
        if a["estado"] != "Producto terminado" or a["inact"]:
            continue
        st, pv, pd, en, vt = ST.get(k, 0.0), PREV.get(k), PED.get(k), E.get(k), VT.get(k)
        if not (st > 0 or (pv and any(x > 0 for x in pv)) or (pd and any(x > 0 for x in pd)) or en or (vt and any(x > 0 for x in vt)) or k in AO
                or (a["alta"] and a["alta"] >= lanz_desde) or k in PFUTV):
            continue
        mand = "Yunsey" if k.startswith("5") else "Belloch"
        lote, mn = TLY[k] if (mand == "Yunsey" and k in TLY) else (a["lote"], a["min"])
        prev = [round(x) for x in pv] if pv else [0] * H
        v0 = vt[12] if vt else 0.0
        refs.append(dict(
            k=k, n=a["name"], md=mand, mc=a["marca"], gp=a["gp"], ln=LIN.get(k, ""), ext=a["ext"], sc=sucesor(A, k), al=a["alta"].isoformat() if a["alta"] else "", fv=FV.get(k),
            st=round(st), mn=round(mn), lt=round(lote), pr=round(a["precio"], 2),
            pv=prev, pv0r=_resto(prev[0], v0, dias_quedan, dias_mes), hp=[round(x) for x in HP.get(k, [0.0] * 12)], pd=[round(x) for x in pd] if pd else [0] * H,
            at=round(ATR.get(k, 0.0)), ab=round(AB.get(k, 0.0)), ao=sorted(AO.get(k, [])), pdd=sorted(PDD.get(k, [])), en=sorted(en or [], key=lambda e: e["d"]),
            vt=[round(x) for x in vt[:12]] if vt else [0] * 12, v0=round(v0),
        ))
        if k in ZTS:
            refs[-1]["zt"] = [dict(k=z, n=A.get(z, {}).get("name", ""), q=q, st=round(ST.get(z, 0.0)),
                                   en=[dict(t=e["t"], q=e["q"], d=e["d"], late=e["late"], **({"id": e["id"]} if e.get("id") else {}))
                                       for e in sorted(E.get(z, []), key=lambda e: e["d"]) if e["t"] in ("OF", "PF", "P")])
                              for z, q in sorted(ZTS[k].items())]

    clasificar(refs, cortes or ABC_DEF["cortes"])
    acierto(refs, dias_quedan, dias_mes)
    amb = {r["k"]: r["mc"] or "—" for r in refs if r["gp"] == "Contra Stock" and r.get("abc") in ("A", "B", "C", "D")}
    vers = acierto_versiones([(v, k, mi, _num(_get(r, iQ))) for v, k, mi, r in pr], cover, VALL, amb, base_y, base_m, {mi for _, mi in vcols})

    refs.sort(key=lambda r: r["k"])
    meta = dict(base=f"{base_y}-{base_m + 1:02d}", hoy=today.isoformat(), version=ver, prev_src=src, hist_src=hsrc, dias=[dias_quedan, dias_mes], n=len(refs), lineas=LNAME, warn=warn, vers=vers)
    pf = porfolio(A, refs, today, base_y, base_m, ST=ST, PREV=PREV, PFUT=PFUT, PPAS=PPAS - PFUT, VL=VL, LIN=LIN, E=E, TLY=TLY, PFUTV=PFUTV, prev=anterior)
    return {"meta": meta, "refs": refs, "porfolio": pf}


# ---------------------------------------------------------------- evaluación
SIN_ENT_MESES = 6  # aviso de "sin stock ni entradas" si la demanda empieza en los 6 próximos meses


def _cuenta(t: str, esc: str) -> bool:
    return t in FIRMES or (esc != "OF" and t == "PF") or (esc == "ALL" and t == "P")


def project(r: dict, esc: str, pv: str = "T"):
    """pv: "T" previsión tal cual, "C" corregida por el sesgo (si la carga la trae)."""
    def inc(t):
        return _cuenta(t, esc)

    p, p0 = (r["pvc"], r["pv0rc"]) if pv == "C" and "pvc" in r else (r["pv"], r["pv0r"])
    # mes en curso: los atrasados vivos de meses anteriores (ab, incluidos en pd) van encima de la previsión
    ab = r.get("ab", 0)
    dem = [ab + max(p0, r["pd"][0] - ab) if m == 0 else max(p[m], r["pd"][m]) for m in range(H)]
    ent = [0] * H
    for e in r["en"]:
        if inc(e["t"]):
            ent[e["m"]] += e["q"]
    stk, s = [], r["st"]
    for m in range(H):
        s = s - dem[m] + ent[m]
        stk.append(s)
    return {"dem": dem, "ent": ent, "stk": stk}


def evaluate(r: dict, horizonte: int = 3, escenario: str = "ALL", prevision: str = "T", exceso: dict | None = None) -> dict:
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
    late_pc = any(e["t"] == "PC" and e["late"] for e in r["en"])
    has_p = any(e["t"] == "P" and e["m"] < hz for e in r["en"])
    cs = r.get("gp") == "Contra Stock"  # los bajo pedido se fabrican contra pedido: sin estos avisos
    rd = rotura_dia(r, allp, escenario)
    ped_antes = cs and rd and rd[0] < hz and rd[1] and rd[2] > 0  # pedidos firmes que no caben antes de la entrada
    sem, why = "verde", "Cubierto en el horizonte"
    if d12 <= 0 and r["st"] >= 0:
        if r["en"] and cs:
            sem, why = "amarillo", "Entradas sin demanda"
        else:
            sem, why = "gris", "Sin demanda prevista" if r["st"] > 0 else "Sin demanda ni stock"
    elif 0 <= rot < hz:
        sem = "rojo"
        if rot == 0 and r["at"] > r["st"]:
            why = "Pedidos atrasados por encima del stock"
        elif rot == 0:
            why = "Rotura este mes"
        else:
            why = f"Rotura en {rot} {'mes' if rot == 1 else 'meses'}"
    elif ped_antes:
        sem, why = "rojo", f"Pedidos sin stock hasta la entrada del {rd[1][8:10]}/{rd[1][5:7]}/{rd[1][2:4]}"
    elif 0 <= bmin < hz:
        sem, why = "naranja", "Por debajo del stock mínimo"
    elif ((0 <= rot_of < hz) or (0 <= bmin_of < hz)) and has_p and escenario == "ALL":
        tarde = any(e["t"] == "P" and "dm" in e and e["m"] < hz for e in r["en"])  # el MRP la quería antes de lo que da el plazo
        sem, why = "amarillo", "Lanzar ya: propuesta sin fijar que no llega en 3 semanas" if tarde else "Depende de propuestas sin fijar"
    if sem == "verde":
        antes = cs and rd and rd[0] < hz and rd[1]
        if antes:
            sem, why = "amarillo", f"Rotura antes de la entrada del {antes[8:10]}/{antes[5:7]}/{antes[2:4]}"
        elif falta_zt(r):  # también bajo pedido: el pedido de compra es firme
            sem, why = "amarillo", falta_zt(r)
        elif late_of:
            sem, why = "amarillo", "OF con fecha pasada"
        elif late_pc:
            sem, why = "amarillo", "Pedido de compra con fecha pasada"
        elif cs and r["st"] <= 0 and not r["en"] and any(x > 0 for x in allp["dem"][:SIN_ENT_MESES]):
            sem, why = "amarillo", "Sin stock ni entradas para la demanda prevista"
    # Exceso: por encima del stock máximo (stock mínimo + lote) si lo hay; si no, lo que seguiría
    # en el almacén pasados N meses sin fabricar nada más (solo contra stock)
    sx = r.get("sx")
    md = r.get("md") or "Belloch"
    n = int((exceso or {}).get(md) or EXCESO_DEF.get(md, 6))
    ex = max(0, round(r["st"] - (sx if sx else sum(allp["dem"][:n]))))
    if sem == "verde" and cs and ex > 0:
        sem, why = "exceso", "Por encima del stock máximo" if sx else f"Stock para más de {n} meses"
    if sem != "exceso":
        ex = 0
    # Faltante: lo que falta en el peor mes del horizonte con el escenario de entradas elegido
    fa = max(0, round(-min(allp["stk"][:hz])), rd[2] if ped_antes else 0)
    return {"sem": sem, "why": why, "rot": rot, "ex": ex, "fa": fa}


ZT_MARGEN = 7  # días naturales: el ZT tiene que estar hecho una semana antes de la fecha del pedido de compra


def _zt_firme(z: dict, hasta: str | None = None) -> float:
    """PT que cubre el ZT con lo firme (su stock y sus OF, las de fecha hasta `hasta` si se da), ÷ ZT por PT."""
    return (max(z["st"], 0) + sum(e["q"] for e in z["en"] if e["t"] == "OF" and (hasta is None or e["d"] <= hasta))) / (z["q"] or 1)


def falta_zt(r: dict) -> str:
    """PT fabricado fuera: el proveedor necesita el ZT del escandallo que fabricamos nosotros. Las propuestas del ZT
    no cuentan: aún no está fabricado. Devuelve el motivo o '':
    - "Falta ZT para el pedido": los pedidos de compra pendientes superan lo que cubre algún ZT con lo firme.
    - "ZT tarde para el pedido del dd/mm/aa": hay ZT, pero no estará ZT_MARGEN días antes de ese pedido
      (cuenta lo acumulado de los pedidos hasta esa fecha)."""
    pcs = sorted((e for e in r["en"] if e["t"] == "PC"), key=lambda e: e["d"])
    pend = sum(e["q"] for e in pcs)
    if not pend or not r.get("zt"):
        return ""
    if any(_zt_firme(z) < pend - 0.5 for z in r["zt"]):
        return "Falta ZT para el pedido"
    acum = 0
    for e in pcs:
        acum += e["q"]
        if not e["d"]:
            continue
        hasta = (dt.date.fromisoformat(e["d"]) - dt.timedelta(days=ZT_MARGEN)).isoformat()
        if any(_zt_firme(z, hasta) < acum - 0.5 for z in r["zt"]):
            return f"ZT tarde para el pedido del {e['d'][8:10]}/{e['d'][5:7]}/{e['d'][2:4]}"
    return ""


def _fraccion(e: dict) -> float:
    """Parte del mes que ha pasado al llegar la entrada: en el mes en curso la trae la carga (f, sobre los días
    que quedan); en los siguientes, (día − 1) ÷ días del mes."""
    if e["m"] == 0:
        return e.get("f", 0)
    if not e.get("d"):
        return 0
    y, m, d = int(e["d"][:4]), int(e["d"][5:7]), int(e["d"][8:10])
    return (d - 1) / calendar.monthrange(y, m)[1]


def rotura_dia(r: dict, p: dict, esc: str):
    """Rotura día a día: la demanda de cada mes repartida por igual en sus días (el mes en curso, en los que quedan)
    y cada entrada en su fecha. Primer mes sin stock y fecha de la entrada que llega tarde ("" si no la hay ese mes),
    o None, y lo que faltaría por los pedidos con fecha (pdd) que vencen antes de esa entrada (0 si es solo por el
    reparto). Hasta cada entrada cuenta lo mayor entre el reparto y esos pedidos: los pedidos del mismo día se sirven
    con la entrada. Gemela de roturaDia en core.js (que además da la fecha estimada)."""
    s = r["st"]
    pdd = r.get("pdd") or []
    for m in range(H):
        d = p["dem"][m]
        es = sorted(((_fraccion(e), e["d"], e) for e in r["en"] if e["m"] == m and _cuenta(e["t"], esc)), key=lambda x: (x[0], x[1]))
        consumido = 0.0  # demanda del mes ya descontada de s
        for f, _, e in es:
            ped = sum(q for fd, pm, q in pdd if pm == m and fd < e["d"])
            hasta = min(d, max(d * f, ped))
            if s - (hasta - consumido) < -1e-9:
                return m, e["d"], round(max(0, ped - consumido - s))
            s += e["q"]
            s -= hasta - consumido
            consumido = hasta
        if s - (d - consumido) < -1e-9:
            return m, "", 0
        s -= d - consumido
    return None
