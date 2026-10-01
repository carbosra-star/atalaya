# Stock mínimo, lote y stock máximo · plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Módulo "Stock mínimo y lotes": calcula lote y stock de seguridad (Excel y estadístico) frente al ERP, propone, guarda decisiones con historial, genera el CSV para ABAS, detecta lo aplicado y usa el stock máximo (SS + lote) como criterio de exceso.

**Architecture:** Cálculo puro en `app/parametros.py` (sin gemela JS), alimentado por los `refs` de la carga vigente, la configuración (`abc.freq`, `abc.ss`, `ns`), las decisiones (`param_dec`) y los plazos extra (`param_extra`). `app.py` expone la API y añade `sx` (stock máximo) a cada referencia del dataset; `evaluate` (core.py y core.js) usa `sx` para el exceso. La pantalla vive en `app.js`.

**Tech Stack:** Python 3.13 + Flask + SQLite; JS de navegador sin framework; pruebas con scripts propios.

**Spec:** `docs/superpowers/specs/2026-10-01-stock-minimo-lotes-design.md`

## Global Constraints

- Idioma: español en UI, mensajes, comentarios y commits.
- `core.py`/`core.js` son gemelas: el cambio de exceso va en las dos (mismo `sem`).
- Ámbito: `gp == "Contra Stock"` y `abc` en A–D.
- Niveles de servicio por defecto `{"Belloch": [95, 90, 85, 85], "Yunsey": [95, 90, 85, 85]}`; plazo base 15 días laborables; mes = 21 días laborables; mínimo 6 meses de historia; umbral de sesgo 20 %.
- Lote: ≥ 10.000 a miles; por debajo a centenas, mínimo 100 si la previsión anual > 0.
- Umbral de ruido: |propuesta − ERP| < máx(10 % del ERP, 100) → se propone el ERP.
- Yunsey: el stock de seguridad estadístico nunca por debajo del ERP.
- CSV ABAS: `Referencia;Mandante;Stock mínimo;Lote`, Latin-1, `;`, CRLF, sin BOM, solo estado `decidido`.
- Fechas en números; € con `fmt`/`eur`/`keur`.
- Pruebas: `python tests/test_core.py`, `python tests/test_parametros.py`, `node tests/test_core_js.js`, `DATA_DIR=$(mktemp -d) PYTHONIOENCODING=utf-8 python tests/test_api.py docs/MM_Supply.xlsx` (bash, desde la raíz del repo).
- Commits en `main` pequeños, uno por tarea, terminados en `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. No hacer push sin preguntar.

## Review Focus

- Configuración guardada antes de este cambio (sin clave `ns`) → `get_config()` debe dar los niveles por defecto; el cálculo no falla. → prueba en Task 2.
- Referencia con `pr == 0` o `None` → Δ € y resumen no fallan ni suman. → prueba en Task 1.
- Decisión "mantener ERP" (ss y lote iguales al ERP) → aplicada al momento, nunca en el CSV. → prueba en Task 2.
- Una decisión ya aplicada que luego cambia en ABAS no vuelve al CSV ni fija el stock máximo. → pruebas en Task 1 y 2.
- Carga anterior evaluada con `sx` calculado sobre sus propias referencias (no las de la carga vigente). → Task 3.

---

### Task 1: Cálculo de parámetros (`app/parametros.py`)

**Files:**
- Create: `app/parametros.py`
- Create: `tests/test_parametros.py`

**Interfaces:**
- Produces:
  - `parametros.NS_DEF: dict[str, list[float]]`
  - `parametros.lote_calc(anual: float, f: float) -> int`
  - `parametros.round100(x: float) -> int`
  - `parametros.parametros(refs, freq, ss_pct, ns, dec, extra) -> list[dict]`; `dec = {ref: {"ss", "lote", "aplicado", ...}}` (decisión vigente), `extra = {ref: dias}`. Cada fila: `k, n, md, abc, ln, pr, pm, er, sg, flag, tipo, mn, lt, xl, est, ssp, lc, ltp, ss, lote, d, estado, smax, de, dx`.
  - `parametros.resumen(rows) -> {"grupos": [...], "estados": {estado: n}}`; cada grupo `md, abc, n, ss_erp, ss_prop, ss_dec, med_erp, med_prop, med_dec` (€ redondeados).

- [ ] **Step 1: Pruebas que fallan** — crear `tests/test_parametros.py`:

```python
"""Pruebas del cálculo de parámetros de planificación (lote, stock de seguridad, stock máximo).

Uso:  python tests/test_parametros.py
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "app"))
import parametros as P  # noqa: E402

fails = 0


def check(name, cond, detail=""):
    global fails
    print(("OK   " if cond else "FALLO"), name, detail)
    if not cond:
        fails += 1


FREQ = {"Belloch": [12, 6, 4, 2], "Yunsey": [6, 4, 2, 1]}
SSP = {"Belloch": [75, 75, 50, 0], "Yunsey": [75, 75, 50, 0]}
NS = P.NS_DEF


def ref(k="P1", **kw):
    r = dict(k=k, n="Prueba", md="Belloch", abc="A", gp="Contra Stock", ln="L1", pr=1.0, st=0, mn=1000, lt=20000,
             pv=[2000] * 12, vt=[800, 1200] * 6, hp=[1000] * 12)
    r.update(kw)
    return r


def calc(rs, dec=None, extra=None):
    return {p["k"]: p for p in P.parametros(rs, FREQ, SSP, NS, dec or {}, extra or {})}


# Lote: previsión anual / fabricaciones; ≥ 10.000 a miles, por debajo a centenas, mínimo 100
check("lote 24.000 / 12 = 2.000", P.lote_calc(24000, 12) == 2000)
check("lote ≥ 10.000 a miles", P.lote_calc(130000, 12) == 11000, P.lote_calc(130000, 12))
check("lote pequeño a centenas, mínimo 100", P.lote_calc(1000, 12) == 100 and P.lote_calc(500, 12) == 100)
check("sin previsión, lote 0", P.lote_calc(0, 12) == 0)

p = calc([ref()])["P1"]
check("lote calculado", p["lc"] == 2000, p["lc"])
check("SS método Excel: lote × 75 %", p["xl"] == 1500, p["xl"])
# Estadístico: error 200/1000 = 0,2; z(95 %) 1,645; previsión trimestre 2.000; √(15/21) → 556 → 600
check("SS estadístico", p["est"] == 600 and p["tipo"] == "ok" and abs(p["er"] - 0.2) < 1e-9, (p["est"], p["tipo"], p["er"]))
check("propuesta = estadístico", p["ssp"] == 600 and p["ltp"] == 2000)
check("con cambio", p["estado"] == "cambio" and not p["d"])
check("Δ € del stock medio", p["de"] == -9400, p["de"])
check("stock máximo con el ERP mientras no se decida", p["smax"] == 21000, p["smax"])
check("previsión/mes del trimestre", p["pm"] == 2000)
check("plazo extra de material", calc([ref()], extra={"P1": 27})["P1"]["est"] == 900)

# Reglas
irr = calc([ref(vt=[0, 0, 0, 3000] * 3)])["P1"]
check("error > 100 %: irregular, sin cifra y a decidir", irr["tipo"] == "irregular" and irr["est"] is None and irr["estado"] == "decidir" and irr["ssp"] == 1000, irr)
check("irregular con sobreprevisión: corregir previsión", irr["flag"] == "corregir")
sh = calc([ref(hp=[0] * 7 + [1000] * 5)])["P1"]
check("menos de 6 meses: sin historia", sh["tipo"] == "sin_hist" and sh["est"] is None and sh["estado"] == "decidir")
sob = calc([ref(mn=500, vt=[600, 1000] * 6)])["P1"]
check("sobreprevisión > 20 %: no sube", sob["est"] == 500 and sob["flag"] == "corregir", (sob["est"], sob["sg"]))
check("límite ×2 del ERP", calc([ref(mn=200)])["P1"]["est"] == 400)
check("límite ×0,5 del ERP", calc([ref(mn=4000)])["P1"]["est"] == 2000)
yun = calc([ref(md="Yunsey")])["P1"]
check("Yunsey no baja del ERP", yun["est"] == 1000 and yun["lc"] == 4000, (yun["est"], yun["lc"]))
check("Yunsey con ERP no múltiplo de 100 no baja", calc([ref(md="Yunsey", mn=250)])["P1"]["est"] >= 250)
check("ruido en el SS: se propone el ERP", calc([ref(mn=650)])["P1"]["ssp"] == 650)
check("ruido en el lote: se propone el ERP", calc([ref(lt=2050)])["P1"]["ltp"] == 2050)
igual = calc([ref(mn=600, lt=2000)])["P1"]
check("igual al ERP", igual["estado"] == "igual" and igual["de"] == 0, igual["estado"])
check("sin lote en el ERP y sin decisión: stock máximo nulo", calc([ref(lt=0)])["P1"]["smax"] is None)
check("bajo pedido fuera", calc([ref(gp="Bajo Pedido")]) == {})
check("ABC NA fuera", calc([ref(abc="NA")]) == {})
check("sin precio: Δ € 0", calc([ref(pr=0)])["P1"]["de"] == 0 and calc([ref(pr=None)])["P1"]["de"] == 0)

# Decisiones
dd = calc([ref()], dec={"P1": dict(ss=800, lote=2000, aplicado=None)})["P1"]
check("decidido", dd["estado"] == "decidido" and dd["ss"] == 800 and dd["lote"] == 2000 and dd["d"], dd["estado"])
check("stock máximo con lo decidido", dd["smax"] == 2800)
ap = calc([ref()], dec={"P1": dict(ss=1000, lote=20000, aplicado="2026-10-01")})["P1"]
check("aplicado", ap["estado"] == "aplicado" and ap["smax"] == 21000)
ign = calc([ref()], dec={"P1": dict(ss=800, lote=2000, aplicado="2026-09-22")})["P1"]
check("aplicada y cambiada después en ABAS: se ignora", ign["estado"] == "cambio" and not ign["d"] and ign["smax"] == 21000, ign["estado"])

# Resumen en € por mandante y clase
rs = P.parametros([ref("A1"), ref("A2", pr=2.0), ref("Y1", md="Yunsey", abc="B")], FREQ, SSP, NS, {"A1": dict(ss=800, lote=2000, aplicado=None)}, {})
res = P.resumen(rs)
ba = next(x for x in res["grupos"] if x["md"] == "Belloch" and x["abc"] == "A")
check("resumen: SS del ERP", ba["ss_erp"] == 1000 * 1 + 1000 * 2, ba)
check("resumen: SS propuesto", ba["ss_prop"] == 600 * 1 + 600 * 2, ba)
check("resumen: SS decidido (decisión o ERP)", ba["ss_dec"] == 800 * 1 + 1000 * 2, ba)
check("resumen: stock medio decidido", ba["med_dec"] == (800 + 1000) * 1 + (1000 + 10000) * 2, ba)
check("resumen: estados", res["estados"] == {"decidido": 1, "cambio": 2}, res["estados"])

print("\nTodo correcto" if not fails else f"\n{fails} comprobaciones fallidas")
sys.exit(1 if fails else 0)
```

- [ ] **Step 2: Ejecutar y ver que falla**

Run: `PYTHONIOENCODING=utf-8 python tests/test_parametros.py`
Expected: `ModuleNotFoundError: No module named 'parametros'`.

- [ ] **Step 3: Implementar `app/parametros.py`**

```python
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
        ssp = est if tipo == "ok" else mn
        if _ruido(ssp, mn):
            ssp = mn
        ltp = lt if _ruido(lc, lt) else lc
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
```

- [ ] **Step 4: Ejecutar**

Run: `PYTHONIOENCODING=utf-8 python tests/test_parametros.py`
Expected: `Todo correcto`. Si alguna cifra del estadístico no cuadra, recalcular a mano con la fórmula del spec antes de tocar código (las cifras de la prueba están derivadas en el diseño de este plan: z(0,95) = 1,6449, √(15/21) = 0,8452, √(42/21) = 1,4142).

- [ ] **Step 5: Commit**

```bash
git add app/parametros.py tests/test_parametros.py
git commit -m "Parámetros: cálculo de lote, stock de seguridad y stock máximo

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Datos y API de parámetros (`app.py`)

**Files:**
- Modify: `app/app.py` (import, `SCHEMA`, `get_config`, `config()`, `upload()`, rutas nuevas)
- Test: `tests/test_api.py`

**Interfaces:**
- Consumes: `parametros.parametros`, `parametros.resumen`, `parametros.NS_DEF` (Task 1).
- Produces:
  - `_param_rows(refs: list[dict]) -> list[dict]` (usa config, decisiones vigentes y plazos extra).
  - `GET /api/parametros[?ref=k]` → `{"rows": [...], "resumen": {...}, "hoy": "AAAA-MM-DD"}` o `{"empty": true}`.
  - `POST /api/parametros/decisiones` `{items: [{ref, ss: {src, v?}, lote: {src, v?}}], motivo}` → `{"ok": true, "n": N}`. Fuentes SS: `erp|excel|estadistico|manual`; lote: `erp|calculado|manual`.
  - `GET /api/parametros/<ref>/historial` → lista con `ss, lote, src_ss, src_lote, ss_antes, lote_antes, motivo, created, aplicado, by`.
  - `PUT /api/parametros/<ref>/plazo` `{dias, motivo}`.
  - `GET /api/parametros/abas.csv`.
  - `get_config()["ns"]`; `PUT /api/config` acepta `ns`.

- [ ] **Step 1: Pruebas que fallan** — en `tests/test_api.py`, justo antes del bloque `# Límite de intentos`, añadir:

```python
# Parámetros de planificación: stock mínimo, lote y stock máximo
check("niveles de servicio por defecto", c.get("/api/me").json["config"].get("ns") == {"Belloch": [95, 90, 85, 85], "Yunsey": [95, 90, 85, 85]})
check("nivel de servicio no válido se rechaza", c.put("/api/config", json={"ns": {"Belloch": [100, 90, 85, 85], "Yunsey": [95, 90, 85, 85]}}, headers=H).status_code == 400)
check("guardar niveles de servicio", c.put("/api/config", json={"ns": {"Belloch": [95, 90, 85, 85], "Yunsey": [95, 90, 85, 85]}}, headers=H).status_code == 200)
pr_ = c.get("/api/parametros").json
rows = {p["k"]: p for p in pr_["rows"]}
check("parámetros: filas solo contra stock con ABC", rows and all(p["abc"] in "ABCD" for p in rows.values()), len(rows))
check("parámetros: resumen por mandante y clase", len(pr_["resumen"]["grupos"]) == 8, [(g["md"], g["abc"]) for g in pr_["resumen"]["grupos"]])
cam = [p for p in rows.values() if p["estado"] == "cambio" and p["est"] is not None]
igu = next(p for p in rows.values() if p["estado"] in ("cambio", "igual") and p is not cam[0])
k1, k2 = cam[0]["k"], igu["k"]
dec = lambda items, motivo="", cl=c: cl.post("/api/parametros/decisiones", json={"items": items, "motivo": motivo}, headers=H)  # noqa: E731
check("decidir: manual sin motivo se rechaza", dec([{"ref": k1, "ss": {"src": "manual", "v": 1234}, "lote": {"src": "erp"}}]).status_code == 400)
check("decidir: fuente no válida se rechaza", dec([{"ref": k1, "ss": {"src": "otra"}, "lote": {"src": "erp"}}]).status_code == 400)
check("decidir: referencia fuera de ámbito se rechaza", dec([{"ref": "999999999999", "ss": {"src": "erp"}, "lote": {"src": "erp"}}]).status_code == 400)
check("decidir: un lector no puede", dec([{"ref": k1, "ss": {"src": "erp"}, "lote": {"src": "erp"}}], cl=c2).status_code == 403)
r = dec([{"ref": k1, "ss": {"src": "manual", "v": cam[0]["mn"] + 700}, "lote": {"src": "calculado"}}], "Prueba de decisión")
check("decidir: manual con motivo", r.status_code == 200 and r.json["n"] == 1, r.json)
p1 = c.get(f"/api/parametros?ref={k1}").json["rows"][0]
check("decisión vigente: decidida con sus valores", p1["estado"] == "decidido" and p1["ss"] == cam[0]["mn"] + 700 and p1["lote"] == cam[0]["lc"], p1)
check("stock máximo con lo decidido en el dataset", next(x for x in c.get("/api/dataset").json["refs"] if x["k"] == k1)["sx"] == p1["ss"] + p1["lote"])
r = dec([{"ref": k2, "ss": {"src": "erp"}, "lote": {"src": "erp"}}], "Mantener")
check("mantener el ERP: aplicada al momento", c.get(f"/api/parametros?ref={k2}").json["rows"][0]["estado"] == "aplicado")
csv = c.get("/api/parametros/abas.csv")
txt = csv.data.decode("latin-1")
check("CSV para ABAS: cabecera y formato", csv.status_code == 200 and txt.startswith("Referencia;Mandante;Stock mínimo;Lote\r\n") and "attachment" in csv.headers.get("Content-Disposition", ""), txt[:80])
check("CSV para ABAS: trae lo decidido", f'{k1};{p1["md"]};{p1["ss"]};{p1["lote"]}\r\n' in txt)
check("CSV para ABAS: no trae lo aplicado", k2 not in txt)
h = c.get(f"/api/parametros/{k1}/historial").json
check("historial con autor, motivo y valores de antes", len(h) == 1 and h[0]["motivo"] == "Prueba de decisión" and h[0]["ss_antes"] == cam[0]["mn"] and h[0]["by"], h)
check("plazo extra fuera de rango se rechaza", c.put(f"/api/parametros/{k1}/plazo", json={"dias": 300}, headers=H).status_code == 400)
check("plazo extra", c.put(f"/api/parametros/{k1}/plazo", json={"dias": 21, "motivo": "Tubos 66 días"}, headers=H).status_code == 200
      and c.get(f"/api/parametros?ref={k1}").json["rows"][0]["dx"] == 21)
# Aplicado al publicar: se fuerza una decisión igual al ERP sin marcar y se republica
import sqlite3  # noqa: E402
con = sqlite3.connect(A.DB_PATH)
k3 = cam[1]["k"]
con.execute("INSERT INTO param_dec(ref,md,ss,lote,src_ss,src_lote,ss_antes,lote_antes,motivo,user_id,created) VALUES(?,?,?,?,'manual','manual',?,?,'x',1,'2026-10-01T10:00:00')",
            (k3, cam[1]["md"], cam[1]["mn"], cam[1]["lt"], cam[1]["mn"], cam[1]["lt"]))
con.commit()
check("antes de publicar: decidida", c.get(f"/api/parametros?ref={k3}").json["rows"][0]["estado"] == "decidido")
upload(c, False)
check("al publicar se marca como aplicada", c.get(f"/api/parametros?ref={k3}").json["rows"][0]["estado"] == "aplicado")
# Aplicada y cambiada después en ABAS: se ignora
con.execute("UPDATE param_dec SET ss=ss+500 WHERE ref=?", (k3,))
con.commit()
p3 = c.get(f"/api/parametros?ref={k3}").json["rows"][0]
check("aplicada y cambiada en ABAS: se ignora", p3["estado"] != "aplicado" and not p3["d"] and k3 not in c.get("/api/parametros/abas.csv").data.decode("latin-1"), p3["estado"])
con.close()
```

(`c2` es el lector creado más arriba en el mismo fichero; `upload` es la función auxiliar del principio.)

- [ ] **Step 2: Ejecutar y ver que falla**

Run: `DATA_DIR=$(mktemp -d) PYTHONIOENCODING=utf-8 python tests/test_api.py docs/MM_Supply.xlsx`
Expected: `FALLO` en "niveles de servicio por defecto" y error 404/KeyError en las siguientes.

- [ ] **Step 3: Implementar en `app/app.py`**

1. Imports: añadir `Response` a `from flask import ...` y `import parametros` junto a `import core`.
2. Al final de `SCHEMA` (antes del `"""` de cierre):

```sql
CREATE TABLE IF NOT EXISTS param_dec(
  id INTEGER PRIMARY KEY, ref TEXT NOT NULL, md TEXT NOT NULL, ss INTEGER NOT NULL, lote INTEGER NOT NULL,
  src_ss TEXT NOT NULL CHECK(src_ss IN ('erp','excel','estadistico','manual')),
  src_lote TEXT NOT NULL CHECK(src_lote IN ('erp','calculado','manual')),
  ss_antes INTEGER, lote_antes INTEGER, motivo TEXT NOT NULL DEFAULT '', user_id INTEGER NOT NULL, created TEXT NOT NULL,
  aplicado TEXT);
CREATE INDEX IF NOT EXISTS param_dec_ref ON param_dec(ref, id);
CREATE TABLE IF NOT EXISTS param_extra(
  ref TEXT PRIMARY KEY, dias INTEGER NOT NULL, motivo TEXT NOT NULL DEFAULT '', user_id INTEGER NOT NULL, created TEXT NOT NULL);
```

3. `get_config`: añadir `"ns": json.loads(json.dumps(parametros.NS_DEF))` al diccionario inicial.
4. `config()`: en la condición de "nada que guardar" añadir `"ns"` a la tupla; antes de `antes = ...`:

```python
    if "ns" in b:
        ns = b["ns"]
        num = lambda x: isinstance(x, (int, float)) and not isinstance(x, bool)  # noqa: E731
        if not (isinstance(ns, dict) and all(isinstance(ns.get(md), list) and len(ns[md]) == 4 and all(num(x) and 50 <= x <= 99.9 for x in ns[md])
                                             for md in ("Belloch", "Yunsey"))):
            return err("Los niveles de servicio deben ser cuatro porcentajes entre 50 y 99,9 para Belloch y Yunsey")
        save["ns"] = {md: ns[md] for md in ("Belloch", "Yunsey")}
```

5. Funciones auxiliares, en una sección nueva `# ---------------------------------------------------------------- parámetros` antes de `# ---------------------------------------------------------------- notas y acciones`:

```python
def _refs(row) -> list[dict]:
    return json.loads(zlib.decompress(row["data"]))["refs"]


def _decisiones() -> dict:
    """Decisión vigente (la última) de cada referencia."""
    q = "SELECT d.* FROM param_dec d JOIN (SELECT ref, MAX(id) AS id FROM param_dec GROUP BY ref) u ON u.id=d.id"
    return {r["ref"]: dict(r) for r in db().execute(q)}


def _param_rows(refs: list[dict]) -> list[dict]:
    cfg = get_config()
    extra = {r["ref"]: r["dias"] for r in db().execute("SELECT ref,dias FROM param_extra")}
    return parametros.parametros(refs, cfg["abc"]["freq"], cfg["abc"]["ss"], cfg["ns"], _decisiones(), extra)


@app.get("/api/parametros")
@need()
def param_list():
    row = _load_row()
    if not row:
        return jsonify({"empty": True})
    rows = _param_rows(_refs(row))
    out = {"rows": rows, "resumen": parametros.resumen(rows), "hoy": row["hoy"]}
    if request.args.get("ref"):
        out["rows"] = [p for p in rows if p["k"] == request.args["ref"]]
    return jsonify(out)


SRC_SS, SRC_LOTE = {"erp": "mn", "excel": "xl", "estadistico": "est", "manual": None}, {"erp": "lt", "calculado": "lc", "manual": None}


@app.post("/api/parametros/decisiones")
@need("admin", "planificador")
def param_decidir():
    b = request.get_json(silent=True) or {}
    items, motivo = b.get("items"), (b.get("motivo") or "").strip()[:500]
    if not isinstance(items, list) or not 1 <= len(items) <= 1000:
        return err("Indica entre 1 y 1.000 referencias")
    row = _load_row()
    if not row:
        return err("No hay datos cargados")
    P = {p["k"]: p for p in _param_rows(_refs(row))}
    ins = []
    for it in items:
        p = P.get(it.get("ref")) if isinstance(it, dict) else None
        if not p:
            return err("Alguna referencia no está entre los productos contra stock con ABC de la carga vigente")
        vals = []
        for key, SRC in (("ss", SRC_SS), ("lote", SRC_LOTE)):
            x = it.get(key) if isinstance(it.get(key), dict) else {}
            src = x.get("src")
            if src not in SRC:
                return err("Fuente no válida")
            if src == "manual":
                v = x.get("v")
                if not (isinstance(v, int) and not isinstance(v, bool) and 0 <= v <= 100_000_000):
                    return err("Los valores manuales deben ser números enteros, cero o mayores")
                if not motivo:
                    return err("Indica el motivo de los valores manuales")
            else:
                v = p[SRC[src]]
                if v is None:
                    return err(f"{p['k']}: el método estadístico no da cifra (irregular o sin historia)")
            vals.append((src, int(v)))
        (sss, ss), (srl, lote) = vals
        aplicado = row["hoy"] if (ss, lote) == (p["mn"], p["lt"]) else None  # mantener el ERP: ya está aplicado
        ins.append((p["k"], p["md"], ss, lote, sss, srl, p["mn"], p["lt"], motivo, g.user["id"], now(), aplicado))
    db().executemany("INSERT INTO param_dec(ref,md,ss,lote,src_ss,src_lote,ss_antes,lote_antes,motivo,user_id,created,aplicado) "
                     "VALUES(?,?,?,?,?,?,?,?,?,?,?,?)", ins)
    db().commit()
    return jsonify({"ok": True, "n": len(ins)})


@app.get("/api/parametros/<ref>/historial")
@need()
def param_historial(ref):
    if not REF_RE.fullmatch(ref):
        return err("La referencia no es válida")
    q = ("SELECT d.ss,d.lote,d.src_ss,d.src_lote,d.ss_antes,d.lote_antes,d.motivo,d.created,d.aplicado,u.name AS by "
         "FROM param_dec d LEFT JOIN users u ON u.id=d.user_id WHERE d.ref=? ORDER BY d.id DESC")
    return jsonify([dict(r) for r in db().execute(q, (ref,))])


@app.put("/api/parametros/<ref>/plazo")
@need("admin", "planificador")
def param_plazo(ref):
    b = request.get_json(silent=True) or {}
    dias = b.get("dias")
    if not REF_RE.fullmatch(ref) or not (isinstance(dias, int) and not isinstance(dias, bool) and 0 <= dias <= 250):
        return err("El plazo extra debe ser un número entero de días laborables entre 0 y 250")
    db().execute("INSERT INTO param_extra(ref,dias,motivo,user_id,created) VALUES(?,?,?,?,?) ON CONFLICT(ref) DO UPDATE SET "
                 "dias=excluded.dias, motivo=excluded.motivo, user_id=excluded.user_id, created=excluded.created",
                 (ref, dias, (b.get("motivo") or "").strip()[:500], g.user["id"], now()))
    db().commit()
    return jsonify({"ok": True})


@app.get("/api/parametros/abas.csv")
@need()
def param_csv():
    row = _load_row()
    if not row:
        return err("No hay datos cargados")
    rows = [p for p in _param_rows(_refs(row)) if p["estado"] == "decidido"]
    txt = "Referencia;Mandante;Stock mínimo;Lote\r\n" + "".join(f'{p["k"]};{p["md"]};{p["ss"]};{p["lote"]}\r\n' for p in rows)
    nombre = f'parametros_abas_{today():%Y%m%d}.csv'
    return Response(txt.encode("latin-1"), mimetype="text/csv", headers={"Content-Disposition": f'attachment; filename="{nombre}"'})
```

6. En `upload()`, justo antes del `db().commit()` que sigue a borrar las cargas viejas (`DELETE FROM loads WHERE id NOT IN ...`):

```python
    # Decisiones de parámetros que la carga nueva ya trae en el ERP: aplicadas
    erp = {r["k"]: (r["mn"], r["lt"]) for r in ds["refs"]}
    for d in _decisiones().values():
        if not d["aplicado"] and erp.get(d["ref"]) == (d["ss"], d["lote"]):
            db().execute("UPDATE param_dec SET aplicado=? WHERE id=?", (ds["meta"]["hoy"], d["id"]))
```

- [ ] **Step 4: Ejecutar**

Run: `DATA_DIR=$(mktemp -d) PYTHONIOENCODING=utf-8 python tests/test_api.py docs/MM_Supply.xlsx`
Expected: todo `OK` salvo "stock máximo con lo decidido en el dataset" (el dataset aún no lleva `sx`), que pasa en la Task 3. Ese único fallo es el esperado en esta tarea; el cierre de la Task 2 se registra con el resultado de `tests/test_parametros.py` y la Task 3 cierra con la batería completa.

- [ ] **Step 5: Commit**

```bash
git add app/app.py tests/test_api.py
git commit -m "Parámetros: decisiones con historial, plazo extra, CSV para ABAS y aplicado al publicar

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Exceso por stock máximo (`sx`)

**Files:**
- Modify: `app/core.py` (`evaluate`), `app/static/core.js` (`evaluate`), `app/app.py` (`dataset`, `upload`)
- Test: `tests/test_core.py`, `tests/test_core_js.js` (las de `test_api.py` ya están en la Task 2)

**Interfaces:**
- Consumes: `_param_rows(refs)` y `p["smax"]` (Task 1–2).
- Produces: cada referencia del dataset lleva `sx` (int o `None`); `evaluate` usa `r.sx`.

- [ ] **Step 1: Pruebas que fallan**

`tests/test_core.py`, tras el bloque de exceso:

```python
# Exceso por stock máximo (stock de seguridad + lote): sustituye al criterio de meses cuando hay sx
check("exceso por encima del stock máximo", core.evaluate(dict(exb, sx=650), 3, "ALL")["ex"] == 50 and core.evaluate(dict(exb, sx=650), 3, "ALL")["why"] == "Por encima del stock máximo")
check("con stock máximo no cuentan los meses", core.evaluate(dict(exb, sx=800), 3, "ALL")["sem"] == "verde")
check("sin stock máximo vuelve a los meses", core.evaluate(dict(exb, sx=None), 3, "ALL")["ex"] == 100)
```

`tests/test_core_js.js`, tras el bloque de exceso:

```js
check('exceso por stock máximo', evaluate({ ...exb, sx: 650 }, cfg).ex === 50 && evaluate({ ...exb, sx: 650 }, cfg).why === 'Por encima del stock máximo');
check('con stock máximo no cuentan los meses', evaluate({ ...exb, sx: 800 }, cfg).sem === 'verde');
check('sin stock máximo vuelve a los meses', evaluate({ ...exb, sx: null }, cfg).ex === 100);
```

- [ ] **Step 2: Ejecutar y ver que fallan**

Run: `PYTHONIOENCODING=utf-8 python tests/test_core.py; node tests/test_core_js.js`
Expected: `FALLO` en las tres nuevas de cada fichero.

- [ ] **Step 3: Implementar**

`core.py`, en `evaluate`, sustituir el bloque de exceso:

```python
    # Exceso: por encima del stock máximo (stock de seguridad + lote) si lo hay; si no, lo que seguiría
    # en el almacén pasados N meses sin fabricar nada más (solo contra stock)
    sx = r.get("sx")
    md = r.get("md") or "Belloch"
    n = int((exceso or {}).get(md) or EXCESO_DEF.get(md, 6))
    ex = max(0, round(r["st"] - (sx if sx else sum(allp["dem"][:n]))))
    if sem == "verde" and cs and ex > 0:
        sem, why = "exceso", "Por encima del stock máximo" if sx else f"Stock para más de {n} meses"
    if sem != "exceso":
        ex = 0
```

`core.js`, mismo bloque:

```js
    // Exceso: por encima del stock máximo (stock de seguridad + lote) si lo hay; si no, lo que seguiría
    // en el almacén pasados N meses sin fabricar nada más (solo contra stock)
    const md = r.md || 'Belloch', n = Math.trunc((cfg.exceso && cfg.exceso[md]) || EXCESO_DEF[md] || 6), sx = r.sx;
    let ex = Math.max(0, Math.round(r.st - (sx ? sx : all.dem.slice(0, n).reduce((s, x) => s + x, 0))));
    if (sem === 'verde' && cs && ex > 0) { sem = 'exceso'; why = sx ? 'Por encima del stock máximo' : `Stock para más de ${n} meses`; }
    if (sem !== 'exceso') ex = 0;
```

`app.py`:

```python
def _con_sx(refs: list[dict]) -> list[dict]:
    """Añade a cada referencia su stock máximo (decidido o del ERP) para el criterio de exceso."""
    sx = {p["k"]: p["smax"] for p in _param_rows(refs)}
    for r in refs:
        r["sx"] = sx.get(r["k"])
    return refs
```

(en la sección de parámetros, tras `_param_rows`). En `dataset()`: tras `ds = json.loads(...)`, `_con_sx(ds["refs"])`; en el bloque de la carga anterior, `refs = _con_sx(json.loads(zlib.decompress(prev["data"]))["refs"])`. En `upload()`, la evaluación del resumen: `sem = {r["k"]: core.evaluate(r, ...)["sem"] for r in _con_sx(json.loads(json.dumps(ds["refs"])))}` (copia, para no guardar `sx` en la carga).

En `pageData` de `app.js`, el texto de ayuda del exceso pasa a: `Exceso (contra stock): el stock de hoy supera el stock máximo (stock de seguridad + lote); si no tiene lote, la demanda de los próximos meses indicados.`

- [ ] **Step 4: Ejecutar todo**

Run: `PYTHONIOENCODING=utf-8 python tests/test_core.py && node tests/test_core_js.js && PYTHONIOENCODING=utf-8 python tests/test_parametros.py && DATA_DIR=$(mktemp -d) PYTHONIOENCODING=utf-8 python tests/test_api.py docs/MM_Supply.xlsx`
Expected: `Todo correcto` en los cuatro, incluida la paridad core.py/core.js y "stock máximo con lo decidido en el dataset".

- [ ] **Step 5: Commit**

```bash
git add app/core.py app/static/core.js app/app.py app/static/app.js tests/test_core.py tests/test_core_js.js
git commit -m "Exceso por encima del stock máximo (stock de seguridad + lote)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Pantalla "Stock mínimo y lotes"

**Files:**
- Modify: `app/static/app.js` (menú en `shell`, `ROUTES`, `SOON`, página nueva `pageParams`)
- Modify: `app/static/app.css` (estilos mínimos de la tabla de decisión)

**Interfaces:**
- Consumes: `GET /api/parametros`, `POST /api/parametros/decisiones`, `GET /api/parametros/abas.csv` (Task 2).
- Produces: ruta `#/parametros` con query `md, abc, ln, estado` (por defecto `decidir,cambio`); helpers `PEST` (textos de estado) y `srcProp(p)`.

- [ ] **Step 1: Menú y ruta**

En `shell()`: `const soon = [['desviacion', 'Desviación de previsiones'], ['consolidador', 'Consolidador de previsiones']];` y, dentro del grupo `g2`, antes de los "pronto": `<a role="listitem" href="#/parametros" data-nav="parametros">Stock mínimo y lotes</a>`. En `ROUTES` añadir `parametros: pageParams`. En `SOON` borrar la entrada `'stock-minimo'`.

- [ ] **Step 2: Página** — añadir antes de `// ---------------------------------------------------------------- Usuarios (admin)`:

```js
// ---------------------------------------------------------------- Stock mínimo y lotes
const PEST = { decidir: 'Decidir a mano', cambio: 'Con cambio', igual: 'Igual', decidido: 'Pendiente de ABAS', aplicado: 'Aplicado' };
const PTIPO = { irregular: 'irregular', sin_hist: 'sin historia' };
// Fuentes que corresponden a la propuesta, para aceptarla tal cual
const srcProp = (p) => ({ ss: { src: p.ssp === p.mn ? 'erp' : 'estadistico' }, lote: { src: p.ltp === p.lt ? 'erp' : 'calculado' } });
async function pageParams(main) {
  if (!S.ds) return noData(main, 'Stock mínimo y lotes');
  const P = await api('/api/parametros');
  if (P.empty) return noData(main, 'Stock mínimo y lotes');
  const canW = can('admin', 'planificador'), { q } = parseHash();
  const estF = (q.get('estado') || 'decidir,cambio').split(','), md = q.get('md') || '', abc = q.get('abc') || '', ln = q.get('ln') || '';
  const xs = P.rows.filter(p => estF.includes(p.estado) && (!md || p.md === md) && (!abc || p.abc === abc) && (!ln || (p.ln || '—') === ln))
    .sort((a, b) => Math.abs(b.de) - Math.abs(a.de) || (a.k < b.k ? -1 : 1));
  const E = P.resumen.estados, nAbas = E.decidido || 0;
  const tot = (k) => P.resumen.grupos.reduce((s, g) => s + g[k], 0);
  const opts = (vals, cur, all) => `<option value="">${all}</option>` + vals.map(v => `<option ${v === cur ? 'selected' : ''}>${esc(v)}</option>`).join('');
  const cnt = (est, t) => `<a class="kpi kpi-link" href="#/parametros?estado=${est}"><div class="v">${fmt(E[est] || 0)}</div><div class="l">${t}</div></a>`;
  const pct = (x) => x == null ? '<span class="muted">—</span>' : Math.round(x * 100) + ' %';
  const n0 = (v) => v == null ? '<span class="muted">—</span>' : fmt(v);
  const fila = (p) => {
    const marca = [PTIPO[p.tipo], p.flag ? 'corregir previsión' : ''].filter(Boolean).join(' · ');
    const ctl = canW ? `<td class="nowrap"><select data-ss="${esc(p.k)}" aria-label="Stock de seguridad de ${esc(p.k)}"><option value="erp">ERP</option><option value="excel">Excel</option><option value="estadistico" ${p.est == null ? 'disabled' : ''}>Estadístico</option><option value="manual">Manual</option></select>
        <input type="number" min="0" step="100" data-ssv="${esc(p.k)}" hidden aria-label="Stock de seguridad manual" style="width:90px">
        <select data-lt="${esc(p.k)}" aria-label="Lote de ${esc(p.k)}"><option value="erp">ERP</option><option value="calculado">Calculado</option><option value="manual">Manual</option></select>
        <input type="number" min="0" step="100" data-ltv="${esc(p.k)}" hidden aria-label="Lote manual" style="width:90px">
        <button class="btn ghost sm" data-dec="${esc(p.k)}">Decidir</button></td>` : '';
    return `<tr>${refCell({ k: p.k, n: p.n })}<td>${abcTag(p.abc)}</td><td class="r num">${fmt(p.pm)}</td><td class="r num">${pct(p.er)}</td>
      <td class="r num">${fmt(p.mn)}</td><td class="r num">${fmt(p.xl)}</td><td class="r num">${n0(p.est)}</td><td class="r num"><b>${fmt(p.d ? p.ss : p.ssp)}</b></td>
      <td class="r num">${fmt(p.lt)}</td><td class="r num"><b>${fmt(p.d ? p.lote : p.ltp)}</b></td><td class="r num ${p.de > 0 ? 'neg' : ''}">${p.pr > 0 ? eur(p.de) : '<span class="muted">sin precio</span>'}</td>
      <td class="nowrap">${PEST[p.estado]}${marca ? ` <span class="muted small">(${marca})</span>` : ''}</td>${ctl}</tr>`;
  };
  const lim = 300;
  main.innerHTML = `<h1>Stock mínimo y lotes</h1>
    <p class="lead">Contra stock con ABC. Stock de seguridad: ERP, método Excel (lote × % de la clase) y estadístico (nivel de servicio × error de previsión × plazo). Propuesta: estadístico si hay cifra; si no, el ERP.</p>
    <div class="tw"><table class="fit"><caption class="sr">Valor por mandante y clase</caption><thead><tr><th scope="col">Mandante · clase</th><th scope="col" class="r">Refs</th><th scope="col" class="r">SS ERP</th><th scope="col" class="r">SS propuesta</th><th scope="col" class="r">SS decidido</th><th scope="col" class="r">Stock medio ERP</th><th scope="col" class="r">Stock medio propuesta</th><th scope="col" class="r">Stock medio decidido</th></tr></thead><tbody>
      ${P.resumen.grupos.map(g => `<tr><th scope="row">${esc(g.md)} · ${abcTag(g.abc)}</th><td class="r num">${fmt(g.n)}</td><td class="r num">${keur(g.ss_erp)}</td><td class="r num">${keur(g.ss_prop)}</td><td class="r num">${keur(g.ss_dec)}</td><td class="r num">${keur(g.med_erp)}</td><td class="r num">${keur(g.med_prop)}</td><td class="r num">${keur(g.med_dec)}</td></tr>`).join('')}
      <tr><th scope="row"><b>Total</b></th><td class="r num"><b>${fmt(tot('n'))}</b></td>${['ss_erp', 'ss_prop', 'ss_dec', 'med_erp', 'med_prop', 'med_dec'].map(k => `<td class="r num"><b>${keur(tot(k))}</b></td>`).join('')}</tr></tbody></table></div>
    <div class="kpis">${cnt('decidir', 'Por decidir a mano')}${cnt('cambio', 'Con cambio propuesto')}${cnt('decidido', 'Decididos, pendientes de ABAS')}${cnt('aplicado', 'Aplicados')}</div>
    <p>${nAbas ? `<a class="btn" href="/api/parametros/abas.csv" download>Descargar cambios para ABAS (${fmt(nAbas)})</a>` : '<span class="muted">No hay cambios pendientes de cargar en ABAS.</span>'}</p>
    <form class="filters" id="pF" onsubmit="return false">
      <label class="fld">Estado<select name="estado">${[['decidir,cambio', 'Por decidir y con cambio'], ['decidir', PEST.decidir], ['cambio', PEST.cambio], ['decidido', PEST.decidido], ['aplicado', PEST.aplicado], ['igual', PEST.igual]].map(([v, t]) => `<option value="${v}" ${estF.join(',') === v ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
      <label class="fld">Mandante<select name="md">${opts(['Belloch', 'Yunsey'], md, 'Todos')}</select></label>
      <label class="fld">ABC<select name="abc">${opts(['A', 'B', 'C', 'D'], abc, 'Todas')}</select></label>
      <label class="fld">Línea<select name="ln">${opts([...new Set(P.rows.map(p => p.ln || '—'))].sort(), ln, 'Todas')}</select></label>
      ${canW ? `<label class="fld" style="flex:1 1 260px">Motivo (obligatorio si hay valores manuales)<input name="motivo" maxlength="500" id="pMot"></label>` : ''}
    </form>
    <div class="toolbar"><span class="count">${fmt(xs.length)} referencias${xs.length > lim ? ` · se muestran las ${lim} de más impacto` : ''}</span>
      ${canW && xs.some(p => p.estado === 'cambio') ? `<button class="btn ghost sm" id="pBulk">Aceptar las ${fmt(xs.filter(p => p.estado === 'cambio').length)} propuestas con cambio</button>` : ''}</div>
    <div class="tw"><table class="ptab"><caption class="sr">Parámetros por referencia</caption><thead><tr><th scope="col">Referencia</th><th scope="col">ABC</th><th scope="col" class="r">Previsión/mes</th><th scope="col" class="r">Error</th>
      <th scope="col" class="r">SS ERP</th><th scope="col" class="r">SS Excel</th><th scope="col" class="r">SS estadístico</th><th scope="col" class="r">SS propuesta</th><th scope="col" class="r">Lote ERP</th><th scope="col" class="r">Lote propuesta</th><th scope="col" class="r">Δ € stock medio</th><th scope="col">Estado</th>${canW ? '<th scope="col">Decisión</th>' : ''}</tr></thead>
      <tbody>${xs.slice(0, lim).map(fila).join('') || `<tr><td colspan="${canW ? 13 : 12}" class="empty">Nada con estos filtros.</td></tr>`}</tbody></table></div>
    <p class="muted small">Δ € = variación del stock medio (stock de seguridad + lote/2) a coste frente al ERP. Previsión/mes: media de los 3 próximos meses. Error: desviación típica de (venta − previsión) ÷ venta media, 12 meses cerrados.</p>`;
  $('#pF').addEventListener('change', (ev) => { const n = ev.target.name; if (!n || n === 'motivo') return; setQuery({ [n]: ev.target.value }); pageParams(main); });
  const motivo = () => ($('#pMot') ? $('#pMot').value.trim() : '');
  const enviar = async (items) => { try { const r = await api('/api/parametros/decisiones', { method: 'POST', body: { items, motivo: motivo() } }); toast(`${r.n} ${r.n === 1 ? 'decisión guardada' : 'decisiones guardadas'}`); await pageParams(main); } catch (e) { toast(e.message); } };
  $$('[data-ss],[data-lt]', main).forEach(s => s.onchange = () => { const k = s.dataset.ss || s.dataset.lt, inp = $(`[data-${s.dataset.ss ? 'ssv' : 'ltv'}="${CSS.escape(k)}"]`, main); inp.hidden = s.value !== 'manual'; if (!inp.hidden) inp.focus(); });
  $$('[data-dec]', main).forEach(b => b.onclick = () => {
    const k = b.dataset.dec, e = CSS.escape(k), it = { ref: k };
    for (const [key, sel, val] of [['ss', 'ss', 'ssv'], ['lote', 'lt', 'ltv']]) {
      const src = $(`[data-${sel}="${e}"]`, main).value;
      it[key] = src === 'manual' ? { src, v: parseInt($(`[data-${val}="${e}"]`, main).value, 10) } : { src };
      if (src === 'manual' && !(it[key].v >= 0)) { toast('Escribe el valor manual'); return; }
    }
    enviar([it]);
  });
  const bulk = $('#pBulk');
  if (bulk) bulk.onclick = () => { const its = xs.filter(p => p.estado === 'cambio').map(p => ({ ref: p.k, ...srcProp(p) })); if (confirm(`¿Aceptar la propuesta en ${its.length} referencias?`)) enviar(its); };
}
```

En cada fila, los selectores arrancan en la fuente de la propuesta: tras pintar, `xs.slice(0, lim).forEach(p => { const sp = srcProp(p), e = CSS.escape(p.k); const a = $(`[data-ss="${e}"]`, main), b = $(`[data-lt="${e}"]`, main); if (a) a.value = sp.ss.src; if (b) b.value = sp.lote.src; });` — añadirlo justo después de asignar `main.innerHTML`.

- [ ] **Step 3: Estilos** — en `app.css`, al final:

```css
.ptab select{font-size:13px;padding:2px 4px}.ptab td{vertical-align:middle}
```

- [ ] **Step 4: Comprobar en la app** (instancia de prueba en el puerto 8010 con datos propios, script `shot.js` del scratchpad):
- Menú: "Stock mínimo y lotes" ya no lleva "pronto" y abre la página.
- Resumen: 8 filas mandante × clase + total; con el MM_Supply del 01/10 el SS ERP total ≈ 680 k€ y la propuesta algo por debajo.
- Lista por defecto: estados decidir + cambio, ordenada por |Δ €|.
- Decidir una fila con Manual sin motivo → aviso; con motivo → "1 decisión guardada" y pasa a "Pendiente de ABAS"; contador y botón de CSV aparecen.
- "Aceptar las N propuestas con cambio" con un filtro (p. ej. Belloch · C) → se guardan.
- Descargar el CSV y abrirlo: cabecera y códigos con ceros.
- Lector (crear uno en Usuarios): ve la tabla sin controles.

- [ ] **Step 5: Commit**

```bash
git add app/static/app.js app/static/app.css
git commit -m "Pantalla de stock mínimo y lotes: resumen en €, lista de decisión y fichero para ABAS

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Ficha (bloque Parámetros) y niveles de servicio en Datos

**Files:**
- Modify: `app/static/app.js` (`pageRef`, `abcForm`, envío de `#abcF`)

**Interfaces:**
- Consumes: `GET /api/parametros?ref=k`, `GET /api/parametros/<k>/historial`, `PUT /api/parametros/<k>/plazo`, `S.cfg.ns`, `PEST`, `PTIPO`.

- [ ] **Step 1: Ficha** — en `pageRef`, dentro de `draw`, ampliar el `Promise.all` con `api('/api/parametros?ref=' + encodeURIComponent(k))` y `api('/api/parametros/' + encodeURIComponent(k) + '/historial')` (`const [notes, acts, par, hist] = ...`). Insertar antes de `<h2>Acierto de la previsión</h2>`:

```js
      ${(() => { const p = par && par.rows && par.rows[0]; if (!p) return '';
        const SRC = { erp: 'ERP', excel: 'Excel', estadistico: 'estadístico', manual: 'manual', calculado: 'calculado' };
        return `<h2>Parámetros</h2>
        <div class="kpis"><div class="kpi"><div class="v">${fmt(p.mn)} · ${fmt(p.lt)}</div><div class="l">ERP: stock mínimo · lote</div></div>
          <div class="kpi"><div class="v">${fmt(p.xl)} · ${p.est == null ? '—' : fmt(p.est)}</div><div class="l">SS Excel · estadístico${PTIPO[p.tipo] ? ' (' + PTIPO[p.tipo] + ')' : ''}${p.flag ? ' · corregir previsión' : ''}</div></div>
          <div class="kpi"><div class="v">${fmt(p.ssp)} · ${fmt(p.ltp)}</div><div class="l">Propuesta: SS · lote</div></div>
          <div class="kpi"><div class="v">${p.d ? fmt(p.ss) + ' · ' + fmt(p.lote) : '—'}</div><div class="l">${PEST[p.estado]}${p.smax ? ' · stock máximo ' + fmt(p.smax) : ''}</div></div></div>
        ${can('admin', 'planificador') ? `<form class="form" id="plzF" style="max-width:none"><div class="row"><label>Plazo extra de material (días laborables)<input type="number" name="dias" min="0" max="250" value="${p.dx}"></label><label style="flex:1">Motivo<input name="motivo" maxlength="500"></label><button class="btn ghost">Guardar plazo</button></div></form>` : (p.dx ? `<p class="muted small">Plazo extra de material: ${p.dx} días laborables.</p>` : '')}
        ${hist.length ? `<div class="tw"><table class="fit"><caption class="sr">Historial de decisiones</caption><thead><tr><th scope="col">Fecha</th><th scope="col">Por</th><th scope="col" class="r">SS</th><th scope="col" class="r">Lote</th><th scope="col">Antes (ERP)</th><th scope="col">Motivo</th><th scope="col">Aplicado</th></tr></thead><tbody>
          ${hist.map(h => `<tr><td class="num">${fdt(h.created)}</td><td>${esc(h.by || '')}</td><td class="r num">${fmt(h.ss)} <span class="muted small">${SRC[h.src_ss]}</span></td><td class="r num">${fmt(h.lote)} <span class="muted small">${SRC[h.src_lote]}</span></td><td class="num">${fmt(h.ss_antes)} · ${fmt(h.lote_antes)}</td><td>${esc(h.motivo)}</td><td class="num">${h.aplicado ? fdate(h.aplicado) : '<span class="muted">—</span>'}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted small">Sin decisiones todavía. Se deciden en <a href="#/parametros">Stock mínimo y lotes</a>.</p>'}`; })()}
```

Y tras los `onsubmit` existentes de la ficha:

```js
    const pz = $('#plzF'); if (pz) pz.onsubmit = async (ev) => { ev.preventDefault(); try { await api('/api/parametros/' + encodeURIComponent(k) + '/plazo', { method: 'PUT', body: { dias: parseInt(pz.dias.value, 10), motivo: pz.motivo.value } }); toast('Plazo guardado'); draw(); } catch (e2) { toast(e2.message); } };
```

- [ ] **Step 2: Niveles de servicio en Datos** — en `abcForm`, la función `fila` lee de `a[{ fr: 'freq', ss: 'ss' }[pre]]` o, para `ns`, de `(S.cfg.ns || {})`:

```js
  const src = (pre) => pre === 'ns' ? (S.cfg.ns || {}) : a[pre === 'fr' ? 'freq' : 'ss'];
  const fila = (md, pre, lbl) => `<tr><th scope="row">${md} · ${lbl}</th>${ABC_CL.map((c, i) => `<td>${inp(`${pre}_${md}_${c}`, (src(pre)[md] || [])[i] ?? '')}</td>`).join('')}</tr>`;
```

y en el `tbody`: `${['Belloch', 'Yunsey'].map(md => fila(md, 'fr', 'fabricaciones/año') + fila(md, 'ss', '% SS (Excel)') + fila(md, 'ns', 'nivel de servicio %')).join('')}`. En el envío de `#abcF`, el cuerpo pasa a `{ abc: {...}, ns: por('ns') }`; el `toast` dice "Parámetros guardados".

- [ ] **Step 3: Comprobar en la app**
- Ficha de una referencia decidida en la Task 4: bloque Parámetros con ERP, Excel/estadístico, propuesta, decisión y stock máximo; historial con autor, motivo y "Antes (ERP)".
- Guardar plazo extra 27 → el estadístico de esa referencia cambia (si no lo limitan los topes) y el valor se mantiene al recargar.
- Datos: fila "nivel de servicio %" por mandante; guardar 98 en Belloch A → en Stock mínimo y lotes la propuesta de Belloch A sube; volver a 95.

- [ ] **Step 4: Pruebas y commit**

Run: `node -e "new Function(require('fs').readFileSync('app/static/app.js','utf8'))" && DATA_DIR=$(mktemp -d) PYTHONIOENCODING=utf-8 python tests/test_api.py docs/MM_Supply.xlsx`
Expected: sin errores de sintaxis; `Todo correcto`.

```bash
git add app/static/app.js
git commit -m "Ficha: parámetros con historial y plazo extra; niveles de servicio en Datos

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Documentación

**Files:**
- Modify: `README.md`, `CLAUDE.md` del repo padre NO (es del usuario; proponer cambios en el mensaje final)

- [ ] **Step 1: README** — en la tabla "Qué hace", fila nueva tras Porfolio:

```markdown
| Stock mínimo y lotes | Todos (deciden planificador y administrador) | Lote y stock de seguridad por referencia (ERP, método Excel y estadístico), propuesta, decisiones con historial, valor en € por mandante y clase y fichero de cambios para ABAS |
```

En "Lógica de cálculo", añadir:

```markdown
- **Stock mínimo y lotes** (contra stock con ABC): lote = previsión de 12 meses ÷ fabricaciones al año de la clase (a miles desde 10.000, a centenas por debajo). Stock de seguridad método Excel = lote × % de la clase. Estadístico = z(nivel de servicio) × error típico relativo × previsión media del próximo trimestre × √(plazo en meses), con plazo = 15 días laborables + plazo extra de material; error > 100 % = irregular, menos de 6 meses con previsión = sin historia; sobreprevisión > 20 % no sube; límite ×0,5–×2 del ERP; redondeo a centenas; Yunsey no baja. La propuesta es el estadístico (o el ERP si no hay cifra), salvo cambios de menos del 10 % o 100 uds. Las decisiones se guardan con historial; el fichero para ABAS trae las pendientes y, al publicar una carga cuyo ERP ya las tiene, se marcan como aplicadas.
- **Stock máximo** = stock de seguridad + lote (decididos o del ERP). Es el criterio de exceso; sin lote, se usa la demanda de los meses de exceso.
```

y en la lista del semáforo, el punto de Exceso: `- Exceso (solo contra stock): el stock de hoy supera el stock máximo (stock de seguridad + lote); si no tiene lote, la demanda de los próximos 6 meses en Belloch o 12 en Yunsey (configurable en Datos).` En "Pendiente para próximas versiones", quitar "Módulos de stock mínimo y lotes" de la lista de módulos pendientes.

- [ ] **Step 2: Pruebas completas y commit**

Run: `PYTHONIOENCODING=utf-8 python tests/test_core.py && PYTHONIOENCODING=utf-8 python tests/test_parametros.py && node tests/test_core_js.js && DATA_DIR=$(mktemp -d) PYTHONIOENCODING=utf-8 python tests/test_api.py docs/MM_Supply.xlsx`
Expected: `Todo correcto` en los cuatro.

```bash
git add README.md
git commit -m "README: stock mínimo, lotes y stock máximo

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
