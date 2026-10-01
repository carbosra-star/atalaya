"""Parámetros de planificación de los PT contra stock: lote, stock de seguridad (método del Excel y
estadístico) frente al ERP, propuesta, estado de la decisión y stock máximo.

Se calcula en el servidor y no tiene gemela en JS: la evaluación del semáforo solo usa el stock
máximo (`sx`), que app.py añade al dataset. Diseño: docs/superpowers/specs/2026-10-01-stock-minimo-lotes-design.md
"""
from __future__ import annotations

import math
from collections import Counter
from statistics import NormalDist, mean, pstdev

NS_DEF = {"Belloch": [95, 90, 85, 85], "Yunsey": [95, 90, 85, 85]}  # nivel de servicio (%) por clase A, B, C, D
PLAZO_BASE, DIAS_MES = 15, 21  # plazo de fabricación (3 semanas) y días laborables de un mes
HMIN, SESGO = 6, 0.2  # meses mínimos con previsión y umbral de sesgo
CLASES = "ABCD"


def round100(x: float) -> int:
    return max(0, int(round(x / 100.0)) * 100)


def lote_calc(anual: float, f: float) -> int:
    """Previsión anual / fabricaciones al año: a miles desde 10.000, a centenas por debajo (mínimo 100)."""
    if anual <= 0 or not f:
        return 0
    x = anual / f
    return int(round(x / 1000.0)) * 1000 if x >= 10000 else max(100, round100(x))


def _ruido(p: float, erp: float) -> bool:
    return abs(p - erp) < max(0.1 * erp, 100)


def _estadistico(r: dict, ns: float, dias_extra: int):
    """(stock de seguridad | None, tipo, error típico relativo, sesgo, marca)."""
    meses = [(v, p) for v, p in zip(r["vt"], r["hp"]) if p > 0]
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


def parametros(refs: list[dict], freq: dict, ss_pct: dict, ns: dict, dec: dict, extra: dict) -> list[dict]:
    """Una fila por PT contra stock con ABC A–D. dec: decisión vigente por referencia; extra: días de plazo extra."""
    rows = []
    for r in refs:
        if r.get("gp") != "Contra Stock" or r.get("abc") not in CLASES:
            continue
        i, md, k = CLASES.index(r["abc"]), r["md"], r["k"]
        mn, lt, pr = r["mn"], r["lt"], r.get("pr") or 0
        lc = lote_calc(sum(r["pv"]), freq[md][i])
        xl = round100(lc * ss_pct[md][i] / 100)
        dx = int(extra.get(k, 0))
        est, tipo, etr, sesgo, flag = _estadistico(r, ns[md][i], dx)
        # A extinguir o sin previsión (en 12 meses o en el próximo trimestre, p. ej. temporada): sin propuesta
        # automática (daría lote 0 o la mitad del SS por el límite ×0,5), se decide a mano partiendo del ERP
        sin = "extinguir" if r.get("ext") else "sin_prev" if not sum(r["pv"]) or not sum(r["pv"][1:4]) else ""
        if sin:
            est, tipo = None, sin
        ssp = est if tipo == "ok" else mn
        if _ruido(ssp, mn):
            ssp = mn
        ltp = lt if sin or _ruido(lc, lt) else lc
        d = dec.get(k)
        if d and d.get("aplicado") and (d["ss"] != mn or d["lote"] != lt):
            d = None  # se aplicó y después se cambió en ABAS: la decisión ya no manda
        if d:
            ss, lote, estado = d["ss"], d["lote"], ("aplicado" if d.get("aplicado") else "decidido")
            smax = ss + lote if lote > 0 else None
        else:
            ss, lote = ssp, ltp
            estado = "decidir" if tipo != "ok" else ("cambio" if (ssp, ltp) != (mn, lt) else "igual")
            smax = mn + lt if lt > 0 else None
        rows.append(dict(
            k=k, n=r.get("n", ""), md=md, abc=r["abc"], ln=r.get("ln", ""), pr=pr, pm=round(sum(r["pv"][1:4]) / 3),
            er=None if etr is None else round(etr, 3), sg=None if sesgo is None else round(sesgo, 3), flag=flag, tipo=tipo,
            mn=mn, lt=lt, xl=xl, est=est, ssp=ssp, lc=lc, ltp=ltp, ss=ss, lote=lote, d=bool(d), estado=estado,
            smax=smax, de=round(((ss - mn) + (lote - lt) / 2) * pr), dx=dx))
    return rows


def resumen(rows: list[dict]) -> dict:
    """€ del stock de seguridad y del stock medio (SS + lote/2) por mandante y clase: ERP, propuesta y decidido."""
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
    return dict(grupos=grupos, estados=dict(Counter(p["estado"] for p in rows)))
