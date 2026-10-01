"""Desviación de previsiones: corrección propuesta por referencia (ritmo de venta y sesgo histórico)
y resumen por marca, para la revisión con comercial.

Se calcula en el servidor y no tiene gemela en JS. Diseño: docs/superpowers/specs/2026-10-01-desviacion-previsiones-design.md
"""
from __future__ import annotations

CAP, UMBRAL = 0.5, 0.10  # tope de la propuesta automática y corrección mínima que se propone
CLASES = ("A", "B", "C", "D")


def _propuesta(cr, cs):
    """(corrección | None, tipo): la más prudente de las dos; sentidos contrarios → revisar."""
    if cr is None and cs is None:
        return None, "sin_dato"
    if cr is None or cs is None:
        c = cs if cr is None else cr
    elif cr * cs < 0:
        return None, "revisar"
    else:
        c = cr if abs(cr) <= abs(cs) else cs
    c = round(max(-CAP, min(CAP, c)), 2)
    if abs(c) < UMBRAL:
        return 0.0, "sin"
    return c, "propuesta"


def filas(refs: list[dict], acuerdos: dict) -> list[dict]:
    """Una fila por PT contra stock con ABC A–D. acuerdos: acuerdo vigente por referencia ({pct, src})."""
    out = []
    for r in refs:
        if r.get("gp") != "Contra Stock" or r.get("abc") not in CLASES:
            continue
        pv, pr = r["pv"], r.get("pr") or 0
        p12, v12 = sum(pv), sum(r.get("vt") or [])
        cr = v12 / p12 - 1 if (not r.get("ext") and r.get("abcx") == "venta" and p12 > 0 and v12 > 0) else None
        cs = r["fc"] - 1 if r.get("fo") == "ref" and r.get("fc") is not None else None
        cp, tipo = _propuesta(cr, cs)
        a = acuerdos.get(r["k"])
        ca = a["pct"] if a else (cp or 0.0)
        pvc = [max(0, round(x * (1 + ca))) for x in pv]
        eu = sum(pvc) - p12
        out.append(dict(k=r["k"], n=r.get("n", ""), md=r["md"], mc=r.get("mc") or "", abc=r["abc"], pr=pr,
                        p12=round(p12), v12=round(v12), cr=None if cr is None else round(cr, 3), cs=None if cs is None else round(cs, 3),
                        cp=cp, tipo=tipo, estado="acordado" if a else tipo, ca=round(ca, 4), src=a["src"] if a else None,
                        pvc=pvc, eu=round(eu), ee=round(eu * pr)))
    return out


def resumen_marcas(rows: list[dict], refs: list[dict]) -> list[dict]:
    """Por marca (y total): previsión y venta 12 meses, sesgo y error de la previsión vigente pasada,
    nº de propuestas, a revisar y acordadas y efecto de la corrección. Total primero; marcas por venta."""
    R = {r["k"]: r for r in refs}
    g: dict[str, dict] = {}
    for p in rows:
        r = R[p["k"]]
        for key in ("Total", p["mc"] or "—"):
            x = g.setdefault(key, dict(mc=key, n=0, p12=0, v12=0, hp=0.0, vh=0.0, eh=0.0, prop=0, rev=0, acu=0, eu=0, ee=0))
            x["n"] += 1
            x["p12"] += p["p12"]
            x["v12"] += p["v12"]
            for v, h in zip(r.get("vt") or [], r.get("hp") or []):
                if h > 0:
                    x["hp"] += h
                    x["vh"] += v
                    x["eh"] += abs(v - h)
            x["prop"] += p["estado"] == "propuesta"
            x["rev"] += p["estado"] == "revisar"
            x["acu"] += p["estado"] == "acordado"
            x["eu"] += p["eu"]
            x["ee"] += p["ee"]
    for x in g.values():
        x["dv"] = round(x["p12"] / x["v12"] - 1, 3) if x["v12"] else None
        x["sh"] = round(x["hp"] / x["vh"] - 1, 3) if x["vh"] else None
        x["er"] = round(x["eh"] / x["vh"], 3) if x["vh"] else None
        for k in ("hp", "vh", "eh"):
            x[k] = round(x[k])
    tot = g.pop("Total", None)
    return ([tot] if tot else []) + sorted(g.values(), key=lambda x: -x["v12"])
