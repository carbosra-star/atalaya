"""Parámetros de planificación de los PT contra stock: lote, stock mínimo (método del Excel y
estadístico) frente al ERP, propuesta, estado de la decisión y stock máximo.

Se calcula en el servidor y no tiene gemela en JS: la evaluación del semáforo solo usa el stock
máximo (`sx`), que app.py añade al dataset. Diseño: docs/superpowers/specs/2026-10-01-stock-minimo-lotes-design.md
"""
from __future__ import annotations

import math
from collections import Counter
from statistics import NormalDist, mean, median, pstdev

NS_DEF = {"Belloch": [95, 90, 85, 85], "Yunsey": [95, 90, 85, 85]}  # nivel de servicio (%) por clase A, B, C, D
PLAZO_BASE, DIAS_MES = 15, 21  # plazo de fabricación (3 semanas) y días laborables de un mes
HMIN, SESGO = 6, 0.2  # meses mínimos con previsión y umbral de sesgo
CLASES = "ABCD"
FABS = (1, 2, 3, 4, 6, 12, 24)  # fabricaciones al año admitidas para la frecuencia óptima
PCT_DEF = 50  # % del ahorro de lote con la frecuencia óptima que se reinvierte en stock mínimo
ETR_MAX = 1.5  # error tope de los irregulares en el reparto del stock mínimo
N01 = NormalDist()


def round100(x: float) -> int:
    """Múltiplo de 100 más cercano (la mitad sube), nunca negativo."""
    return max(0, math.floor(x / 100.0 + 0.5) * 100)


def lote_calc(anual: float, f: float) -> int:
    """Previsión anual / fabricaciones al año: a miles desde 10.000, a centenas por debajo (mínimo 100)."""
    if anual <= 0 or not f:
        return 0
    x = anual / f
    return math.floor(x / 1000.0 + 0.5) * 1000 if x >= 10000 else max(100, round100(x))


def _fab(n: float) -> int:
    """Fabricaciones al año admitidas más cercanas (en proporción, no en diferencia)."""
    return min(FABS, key=lambda f: abs(math.log(f / n)))


def frecuencia_optima(rows: list[dict], lmin: dict) -> None:
    """Frecuencia por referencia: en cada línea se reparten las fabricaciones de hoy (previsión anual / lote del ERP)
    en proporción a la raíz del consumo anual en € (regla de la raíz cuadrada), redondeadas a FABS. Añade a cada fila
    fe (fabricaciones/año con el lote del ERP), fo (óptima) y lo (lote con esa frecuencia). Sin precio: mediana de la
    línea. Sin lote del ERP, a extinguir o sin previsión: no entra en el reparto (fo, lo = None)."""
    con_pr = [p["pr"] for p in rows if p["pr"]]
    med = median(con_pr) if con_pr else 1.0
    prl: dict[str, list] = {}
    for p in rows:
        if p["pr"]:
            prl.setdefault(p["ln"] or "", []).append(p["pr"])
    lineas: dict[str, list[dict]] = {}
    for p in rows:
        p["fe"] = p["fo"] = p["lo"] = None
        l_ = prl.get(p["ln"] or "")
        p["pp"] = p["pr"] or (median(l_) if l_ else med)  # precio para repartir: sin precio, mediana de la línea
        if p["pa"] > 0 and p["lt"] > 0:
            p["fe"] = round(p["pa"] / p["lt"], 1)
            if p["tipo"] not in ("extinguir", "sin_prev"):
                lineas.setdefault(p["ln"] or "", []).append(p)
    for ln, g in lineas.items():
        w = {p["k"]: math.sqrt(p["pa"] * p["pp"]) for p in g}
        n, sw = sum(p["pa"] / p["lt"] for p in g), sum(w.values())
        lm = lmin.get(ln, 0)
        for p in g:
            p["fo"] = _fab(n * w[p["k"]] / sw)
            p["lo"] = max(lote_calc(p["pa"], p["fo"]), lm)


def _ss_lambda(e: list[dict], lam: float) -> list[float]:
    """Stock mínimo de cada referencia con el mismo beneficio marginal por € (lam): las roturas al año que evita la
    última unidad, n × φ(SM/σ) / σ, valen lam × precio; es decir φ(z) = lam × precio × σ / n, con z ≥ 0."""
    out = []
    for p in e:
        x = lam * p["pp"] * p["sl"] * math.sqrt(2 * math.pi) / p["nr"]  # φ(z) / φ(0)
        v = math.sqrt(-2 * math.log(x)) * p["sl"] if 0 < x < 1 else 0.0
        out.append(min(v, p["mn"]) if p["sg"] is not None and p["sg"] > SESGO else v)  # sobreprevisión: no se sube
    return out


def reparto(rows: list[dict], pct: float) -> None:
    """Stock mínimo repartido con un presupuesto fijo en €: el stock mínimo del ERP más pct % del ahorro de stock medio
    de lote con la frecuencia óptima. Entran las referencias con error de previsión (irregulares con el error a
    ETR_MAX), Yunsey también; el resto conserva el del ERP (0 a extinguir) y se descuenta del presupuesto.
    Añade sr (stock mínimo repartido), nh y nr (fabricaciones/año de hoy y del reparto)."""
    ahorro = sum((p["lt"] - p["lo"]) / 2 * p["pp"] for p in rows if p["lo"] is not None)
    pres = sum(p["mn"] * p["pp"] for p in rows) + pct / 100 * max(0.0, ahorro)
    e = []
    for p in rows:
        p["nh"] = p["fe"] or p["fc"]  # hoy: con el lote del ERP (sin lote, la frecuencia de la clase)
        p["nr"] = p["fo"] or p["nh"]
        if p["sl"] and p["nr"]:
            e.append(p)
        else:
            p["sr"] = 0 if p["tipo"] == "extinguir" else p["mn"]
            pres -= p["sr"] * p["pp"]
    if not e:
        return
    lo, hi = 1e-12, 1e6
    if sum(v * p["pp"] for v, p in zip(_ss_lambda(e, lo), e)) <= pres:
        hi = lo  # el presupuesto da para todo: nivel máximo
    for _ in range(100):
        if hi <= lo:
            break
        mid = math.sqrt(lo * hi)
        if sum(v * p["pp"] for v, p in zip(_ss_lambda(e, mid), e)) > pres:
            lo = mid
        else:
            hi = mid
    for v, p in zip(_ss_lambda(e, hi), e):
        p["sr"] = round100(v)


def roturas(rows: list[dict], ss_key: str, n_key: str) -> float:
    """Roturas al año esperadas: por ciclo de fabricación, probabilidad de que el error de previsión en el plazo
    supere el stock mínimo."""
    return sum(p[n_key] * (1 - N01.cdf(p[ss_key] / p["sl"])) for p in rows if p["sl"] and p[n_key])


def _ruido(p: float, erp: float) -> bool:
    return abs(p - erp) < max(0.1 * erp, 100)


def _estadistico(r: dict, ns: float, dias_extra: int):
    """(stock mínimo | None, tipo, error típico relativo, sesgo, marca)."""
    meses = [(v, p) for v, p in zip(r.get("vt") or [], r.get("hp") or []) if p > 0]  # cargas antiguas sin hp: sin historia
    vm = mean(v for v, _ in meses) if meses else 0
    if len(meses) < HMIN or vm <= 0:
        return None, "sin_hist", None, None, ""
    etr = pstdev([v - p for v, p in meses]) / vm
    sv, sp = sum(v for v, _ in meses), sum(p for _, p in meses)
    sesgo = sp / sv - 1  # positivo: se previó más de lo que se vendió
    flag = "corregir" if abs(sesgo) > SESGO else ""
    if etr > 1:
        return None, "irregular", etr, sesgo, flag
    pq = sum(r["pv"][1:4]) / 3
    v = NormalDist().inv_cdf(ns / 100) * etr * pq * math.sqrt((PLAZO_BASE + dias_extra) / DIAS_MES)
    mn = r["mn"]
    if sesgo > SESGO:  # sobreprevisión: no se sube, se corrige la previsión
        v = min(v, mn)
    if mn > 0:
        v = min(max(v, 0.5 * mn), 2 * mn)
    v = round100(v)
    if r["md"] == "Yunsey":  # hasta la migración, Yunsey solo sube
        v = max(v, mn)
    return v, "ok", etr, sesgo, flag


def parametros(refs: list[dict], freq: dict, ss_pct: dict, ns: dict, dec: dict, extra: dict, lmin: dict | None = None,
               pct: float = PCT_DEF) -> list[dict]:
    """Una fila por PT contra stock con ABC A–D. dec: decisión vigente por referencia; extra: días de plazo extra;
    lmin: lote mínimo (uds) de las líneas que lo tienen; pct: % del ahorro de lote que se reinvierte en stock mínimo."""
    rows, lmin = [], lmin or {}
    for r in refs:
        if r.get("gp") != "Contra Stock" or r.get("abc") not in CLASES:
            continue
        i, md, k = CLASES.index(r["abc"]), r["md"], r["k"]
        mn, lt, pr = r["mn"], r["lt"], r.get("pr") or 0
        lc = lote_calc(sum(r["pv"]), freq[md][i])
        lm = lmin.get(r.get("ln") or "", 0)
        sube = 0 < lc < lm  # la línea no fabrica lotes tan pequeños: el calculado sube a su mínimo
        if sube:
            lc = lm
        xl = round100(lc * ss_pct[md][i] / 100)
        dx = int(extra.get(k, 0))
        est, tipo, etr, sesgo, flag = _estadistico(r, ns[md][i], dx)
        sl = min(etr, ETR_MAX) * sum(r["pv"][1:4]) / 3 * math.sqrt((PLAZO_BASE + dx) / DIAS_MES) if etr is not None else 0
        # A extinguir: se consume el stock del PT y no se repone (stock mínimo y lote 0); si hay que fabricar para
        # gastar material, se decide a mano. Sin previsión en 12 meses o en el próximo trimestre (p. ej.
        # temporada): sin propuesta automática (daría lote 0 o la mitad del stock mínimo), se decide a mano desde el ERP
        sin = "extinguir" if r.get("ext") else "sin_prev" if not sum(r["pv"]) or not sum(r["pv"][1:4]) else ""
        if sin:
            est, tipo = None, sin
        ssp = est if tipo == "ok" else 0 if sin == "extinguir" else mn
        if sin != "extinguir" and _ruido(ssp, mn):
            ssp = mn
        # El del ERP se mantiene si está cerca del calculado, pero nunca por debajo del mínimo de la línea
        ltp = 0 if sin == "extinguir" else lt if sin or (_ruido(lc, lt) and lt >= lm) else lc
        d = dec.get(k)
        if d and d.get("aplicado") and (d["ss"] != mn or d["lote"] != lt):
            d = None  # se aplicó y después se cambió en ABAS: la decisión ya no manda
        if d:
            ss, lote, estado = d["ss"], d["lote"], ("aplicado" if d.get("aplicado") else "decidido")
            smax = ss + lote if lote > 0 else None
        else:
            ss, lote = ssp, ltp
            estado = "decidir" if tipo not in ("ok", "extinguir") else ("cambio" if (ssp, ltp) != (mn, lt) else "igual")
            smax = mn + lt if lt > 0 else None
        rows.append(dict(
            k=k, n=r.get("n", ""), md=md, abc=r["abc"], xyz=r.get("xyz", ""), ln=r.get("ln", ""), pr=pr, pm=round(sum(r["pv"][1:4]) / 3),
            er=None if etr is None else round(etr, 3), sg=None if sesgo is None else round(sesgo, 3), flag=flag, tipo=tipo,
            mn=mn, lt=lt, xl=xl, est=est, ssp=ssp, lc=lc, ltp=ltp, ss=ss, lote=lote, d=bool(d), estado=estado,
            smax=smax, de=round(((ss - mn) + (lote - lt) / 2) * pr), dx=dx, lm=lm or None, lms=sube, pa=sum(r["pv"]),
            sl=sl if tipo in ("ok", "irregular") else 0, fc=freq[md][i]))
    frecuencia_optima(rows, lmin)
    reparto(rows, pct)
    return rows


def resumen(rows: list[dict]) -> dict:
    """€ del stock mínimo y del stock medio (stock mínimo + lote/2) por mandante y clase: ERP, propuesta y decidido."""
    g: dict[tuple, dict] = {}
    for p in rows:
        x = g.setdefault((p["md"], p["abc"]), dict(md=p["md"], abc=p["abc"], n=0, ss_erp=0.0, ss_prop=0.0, ss_dec=0.0,
                                                    med_erp=0.0, med_prop=0.0, med_dec=0.0))
        pr = p["pr"] or 0
        dss, dlt = (p["ss"], p["lote"]) if p["d"] else (p["mn"], p["lt"])
        x["n"] += 1
        x["ss_erp"] += p["mn"] * pr
        x["ss_prop"] += p["ssp"] * pr
        x["ss_dec"] += dss * pr
        x["med_erp"] += (p["mn"] + p["lt"] / 2) * pr
        x["med_prop"] += (p["ssp"] + p["ltp"] / 2) * pr
        x["med_dec"] += (dss + dlt / 2) * pr
    grupos = [{k: round(v) if isinstance(v, float) else v for k, v in x.items()} for _, x in sorted(g.items())]
    fo = [p for p in rows if p["fo"]]  # frecuencia óptima frente al lote del ERP, en las mismas referencias
    frec = dict(n=len(fo), fab_erp=round(sum(p["fe"] for p in fo)), fab_opt=sum(p["fo"] for p in fo),
                lote_erp=round(sum(p["lt"] / 2 * (p["pr"] or 0) for p in fo)), lote_opt=round(sum(p["lo"] / 2 * (p["pr"] or 0) for p in fo)))
    frec.update(ss_erp=round(sum(p["mn"] * p["pp"] for p in rows)), ss_rep=round(sum(p["sr"] * p["pp"] for p in rows)),
                n_rep=sum(1 for p in rows if p["sl"]), rot_erp=round(roturas(rows, "mn", "nh")), rot_rep=round(roturas(rows, "sr", "nr")))
    return dict(grupos=grupos, estados=dict(Counter(p["estado"] for p in rows)), frec=frec)
