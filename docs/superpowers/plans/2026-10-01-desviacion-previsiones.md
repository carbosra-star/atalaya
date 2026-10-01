# Desviación de previsiones · plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sección "Desviación de previsiones": desviación por marca, acierto por versión, lista para la reunión con corrección propuesta (ritmo y sesgo), acuerdos por versión con historial y CSV.

**Architecture:** Cálculo puro en `app/desviacion.py` sobre los `refs` de la carga vigente y los acuerdos (`prev_dec`). El acierto por versión lo calcula `core.parse` (necesita MM_Prev y MM_Vtas completos) con una función pura `core.acierto_versiones` y lo guarda en `meta.vers`. API en `app.py`; pantalla en `app.js`.

**Tech Stack:** Python 3.13 + Flask + SQLite; JS de navegador sin framework.

**Spec:** `docs/superpowers/specs/2026-10-01-desviacion-previsiones-design.md`

## Global Constraints

- Español en UI, mensajes, comentarios y commits.
- Ámbito: `gp == "Contra Stock"` y `abc` en ("A", "B", "C", "D").
- Propuesta: tope ±50 %, redondeo a porcentaje entero, umbral 10 %.
- Acuerdos ligados a `meta.version` de la carga vigente.
- `src` de acuerdos: `propuesta`, `manual`, `mantener`. Manual: % entre −90 y 300, motivo obligatorio.
- CSV: Latin-1 (`errors="replace"`), `;`, CRLF, % con coma decimal, meses mm/aa.
- Fechas en números; € con `fmt`/`eur`/`keur`.
- Pruebas: `python tests/test_core.py`, `python tests/test_parametros.py`, `python tests/test_desviacion.py`, `node tests/test_core_js.js`, `DATA_DIR=$(mktemp -d) PYTHONIOENCODING=utf-8 python tests/test_api.py docs/MM_Supply.xlsx`.
- Commits en `main`, uno por tarea, terminados en `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. `git push` solo si el usuario lo pide, y en un comando aparte.

## Review Focus

- Carga publicada antes del cambio (sin `meta.vers`) → la sección funciona y la tabla de versiones avisa de volver a cargar. → Task 4 (comprobación en la app).
- Referencia con `hp` ausente o `pr` 0/None → resumen y efecto no fallan. → Task 1.
- Acuerdo de una versión anterior no cuenta como vigente en la nueva. → Task 3.
- Motivo con `;`, saltos de línea o caracteres fuera de Latin-1 → CSV válido. → Task 3.
- `abc == ""` o ausente → fuera de ámbito (cuidado con `"" in "ABCD"`). → Task 1.

---

### Task 1: Cálculo por referencia y por marca (`app/desviacion.py`)

**Files:**
- Create: `app/desviacion.py`, `tests/test_desviacion.py`

**Interfaces:**
- Produces: `desviacion.filas(refs, acuerdos) -> list[dict]` con `k, n, md, mc, abc, pr, p12, v12, cr, cs, cp, tipo, estado, ca, src, pvc, eu, ee`; `acuerdos = {ref: {"pct", "src"}}`. `desviacion.resumen_marcas(rows, refs) -> list[dict]` (primera fila `mc == "Total"`) con `mc, n, p12, v12, dv, sh, er, prop, rev, acu, eu, ee`. Constantes `CAP = 0.5`, `UMBRAL = 0.10`.

- [ ] **Step 1: Pruebas que fallan** — crear `tests/test_desviacion.py`:

```python
"""Pruebas de la desviación de previsiones: corrección por ritmo de venta y por sesgo histórico.

Uso:  python tests/test_desviacion.py
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "app"))
import desviacion as D  # noqa: E402

fails = 0


def check(name, cond, detail=""):
    global fails
    print(("OK   " if cond else "FALLO"), name, detail)
    if not cond:
        fails += 1


def ref(k="P1", **kw):
    r = dict(k=k, n="Prueba", md="Belloch", mc="NELLY", abc="A", gp="Contra Stock", pr=2.0, ext=False, abcx="venta",
             pv=[100] * 12, vt=[80] * 12, hp=[100] * 12, fc=0.75, fo="ref")
    r.update(kw)
    return r


def f(rs, ac=None):
    return {p["k"]: p for p in D.filas(rs, ac or {})}


p = f([ref()])["P1"]
check("ritmo: venta 960 / previsión 1.200 − 1", abs(p["cr"] - (-0.2)) < 1e-9, p["cr"])
check("sesgo: factor 0,75 − 1", abs(p["cs"] - (-0.25)) < 1e-9, p["cs"])
check("mismo sentido: la menor", p["cp"] == -0.2 and p["tipo"] == "propuesta" and p["estado"] == "propuesta", (p["cp"], p["tipo"]))
check("previsión corregida y efecto", p["pvc"] == [80] * 12 and p["eu"] == -240 and p["ee"] == -480, (p["pvc"][:2], p["eu"], p["ee"]))
rv = f([ref(fc=1.3)])["P1"]
check("sentidos contrarios: revisar sin cifra", rv["tipo"] == "revisar" and rv["cp"] is None and rv["ca"] == 0 and rv["eu"] == 0, rv["tipo"])
check("tope −50 %", f([ref(vt=[20] * 12, fc=0.5)])["P1"]["cp"] == -0.5)
check("tope con solo el ritmo", f([ref(vt=[20] * 12, fo="grupo")])["P1"]["cp"] == -0.5)
sn = f([ref(vt=[95] * 12, fo="grupo")])["P1"]
check("menos del 10 %: sin corrección", sn["cp"] == 0 and sn["tipo"] == "sin", (sn["cp"], sn["tipo"]))
check("redondeo a porcentaje entero", f([ref(vt=[77] * 12)])["P1"]["cp"] == -0.23)
check("a extinguir: sin ritmo", f([ref(ext=True, fo="grupo")])["P1"]["tipo"] == "sin_dato")
check("ABC provisional (menos de 12 meses de venta): sin ritmo", f([ref(abcx="anual")])["P1"]["cr"] is None)
check("sin venta: sin ritmo", f([ref(vt=[0] * 12)])["P1"]["cr"] is None)
check("sesgo de grupo: no cuenta", f([ref(fo="grupo")])["P1"]["cs"] is None)
ac = f([ref()], {"P1": dict(pct=-0.1, src="manual")})["P1"]
check("acuerdo vigente", ac["estado"] == "acordado" and ac["ca"] == -0.1 and ac["pvc"] == [90] * 12 and ac["eu"] == -120 and ac["src"] == "manual", ac)
check("previsión corregida nunca negativa", min(f([ref()], {"P1": dict(pct=-0.9, src="manual")})["P1"]["pvc"]) >= 0)
check("bajo pedido fuera", f([ref(gp="Bajo Pedido")]) == {})
check("ABC NA, vacío o ausente fuera", f([ref(abc="NA")]) == {} and f([ref(abc="")]) == {} and f([ref(abc=None)]) == {})
check("sin precio: efecto € 0", f([ref(pr=0)])["P1"]["ee"] == 0 and f([ref(pr=None)])["P1"]["ee"] == 0)

# Resumen por marca: sesgo y error históricos con los meses que tenían previsión
rs = [ref("A1"), ref("A2"), ref("B1", mc="DRN", vt=[100] * 12)]
filas = D.filas(rs, {})
res = D.resumen_marcas(filas, rs)
check("primera fila: total", res[0]["mc"] == "Total" and res[0]["n"] == 3, res[0])
nel = next(x for x in res if x["mc"] == "NELLY")
check("marca: previsión y venta 12 meses", nel["p12"] == 2400 and nel["v12"] == 1920 and abs(nel["dv"] - 0.25) < 1e-9, nel)
check("marca: sesgo histórico", abs(nel["sh"] - 0.25) < 1e-9 and abs(nel["er"] - 0.25) < 1e-9, nel)
check("marca: propuestas y efecto", nel["prop"] == 2 and nel["eu"] == -480, nel)
check("marcas ordenadas por venta", [x["mc"] for x in res[1:]] == ["NELLY", "DRN"])
sinhp = ref("H1"); del sinhp["hp"]
check("sin histórico de previsión: no falla", D.resumen_marcas(D.filas([sinhp], {}), [sinhp])[1]["sh"] is None)

print("\nTodo correcto" if not fails else f"\n{fails} comprobaciones fallidas")
sys.exit(1 if fails else 0)
```

- [ ] **Step 2: Ejecutar y ver que falla** — `PYTHONIOENCODING=utf-8 python tests/test_desviacion.py` → `ModuleNotFoundError: No module named 'desviacion'`.

- [ ] **Step 3: Implementar `app/desviacion.py`**

```python
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
```

- [ ] **Step 4: Ejecutar** — `PYTHONIOENCODING=utf-8 python tests/test_desviacion.py` → `Todo correcto`.

- [ ] **Step 5: Commit**

```bash
git add app/desviacion.py tests/test_desviacion.py
git commit -m "Desviación de previsiones: corrección propuesta por ritmo y sesgo, y resumen por marca

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Acierto por versión en `core.parse`

**Files:**
- Modify: `app/core.py` (función nueva `acierto_versiones`; `parse`: venta de todos los meses cerrados y `meta.vers`)
- Test: `tests/test_core.py`

**Interfaces:**
- Produces: `core.acierto_versiones(items, cover, sales, amb, base_y, base_m) -> list[dict]` con `v, mc, e, s, p, n, m`; `items` = lista de `(versión, ref, mes, cantidad)`; `cover` = `{versión: set(meses)}`; `sales` = `{ref: {mes: uds}}` (meses cerrados, índice respecto al mes en curso); `amb` = `{ref: marca}`. `meta.vers` en el dataset.

- [ ] **Step 1: Prueba que falla** — en `tests/test_core.py`, antes del resumen final:

```python
# Acierto de cada versión trimestral: meses cerrados desde el inicio de su trimestre, solo refs con filas
# Base 10/2026 (base_m = 9): 2026Q3 empieza en 07/2026 = mes −3
items = [("2026Q3", "R1", -5, 50), ("2026Q3", "R1", -3, 100), ("2026Q3", "R1", -2, 100), ("2026Q3", "R1", 1, 100), ("2026Q3", "R2", -3, 70)]
cover = {"2026Q3": set(range(-5, 3))}
sales = {"R1": {-3: 80, -2: 120, -1: 90}, "R3": {-2: 500}}
av = core.acierto_versiones(items, cover, sales, {"R1": "NELLY", "R3": "NELLY"}, 2026, 9)
check("acierto por versión: solo meses cerrados desde el inicio del trimestre", av == [dict(v="2026Q3", mc="NELLY", e=130, s=290, p=200, n=1, m=3)], av)
```

(`R2` no está en el ámbito; `R3` no tiene filas en la versión; −5 es anterior al trimestre y 1 no está cerrado. Meses −3, −2, −1: previsión 100, 100, 0; venta 80, 120, 90.)

- [ ] **Step 2: Ejecutar y ver que falla** — `AttributeError: module 'core' has no attribute 'acierto_versiones'`.

- [ ] **Step 3: Implementar**

En `core.py`, después de `vigentes`:

```python
def _inicio(v: str, base_y: int, base_m: int) -> int:
    """Primer mes (índice respecto al mes en curso) del trimestre de la versión AAAAQn."""
    return (int(v[:4]) - base_y) * 12 + 3 * (int(v[5]) - 1) - base_m


def acierto_versiones(items, cover, sales, amb, base_y, base_m) -> list[dict]:
    """Error de cada versión contra la venta real, por (versión, marca): meses cerrados que cubre la
    versión desde el inicio de su trimestre, solo referencias del ámbito con filas en ese periodo.
    items: (versión, ref, mes, cantidad); sales: {ref: {mes: uds}}; amb: {ref: marca}."""
    ph: dict[tuple, dict] = {}
    for v, k, mi, q in items:
        if k in amb and _inicio(v, base_y, base_m) <= mi < 0:
            d = ph.setdefault((v, k), {})
            d[mi] = d.get(mi, 0.0) + q
    acc: dict[tuple, dict] = {}
    for (v, k), d in ph.items():
        meses = sorted(m for m in cover[v] if _inicio(v, base_y, base_m) <= m < 0)
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
```

En `parse`:
1. En el bucle de ventas, junto a `VT`, guardar todos los meses cerrados: antes del bucle `VALL: dict[str, dict[int, float]] = {}`; dentro, en `for j, mi in vcols:` tras `q = ...`: `if mi < 0: VALL.setdefault(k, {})[mi] = VALL.get(k, {}).get(mi, 0.0) + q`.
2. Tras `acierto(refs, dias_quedan, dias_mes)`:

```python
    amb = {r["k"]: r["mc"] or "—" for r in refs if r["gp"] == "Contra Stock" and r.get("abc") in ("A", "B", "C", "D")}
    vers = acierto_versiones([(v, k, mi, _num(_get(r, iQ))) for v, k, mi, r in pr], cover, VALL, amb, base_y, base_m)
```

y añadir `vers=vers` a `meta`.

- [ ] **Step 4: Ejecutar** — `PYTHONIOENCODING=utf-8 python tests/test_core.py` → `Todo correcto`. Comprobar con datos reales:

```bash
PYTHONIOENCODING=utf-8 python -c "
import sys,datetime as dt; sys.path.insert(0,'app'); import core
ds=core.parse(core.read_workbook('docs/MM_Supply.xlsx'),dt.date(2026,10,1)); V=ds['meta']['vers']
from collections import defaultdict; t=defaultdict(lambda:[0,0,0])
for x in V: a=t[x['v']]; a[0]+=x['e']; a[1]+=x['s']; a[2]+=x['p']
for v,(e,s,p) in sorted(t.items()): print(v, 'error', round(e/s,3) if s else None, 'sesgo', round(p/s-1,3) if s else None)"
```

Expected: una línea por versión 2024Q4…2026Q3 (2026Q4 sin meses cerrados no aparece), errores entre 0,2 y 1.

- [ ] **Step 5: Commit**

```bash
git add app/core.py tests/test_core.py
git commit -m "Acierto de cada versión de previsión contra la venta real, por marca

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Datos y API (`app.py`)

**Files:**
- Modify: `app/app.py` (import, `SCHEMA`, sección nueva de rutas)
- Test: `tests/test_api.py`

**Interfaces:**
- Consumes: `desviacion.filas`, `desviacion.resumen_marcas` (Task 1); `meta.vers` (Task 2).
- Produces: `GET /api/desviacion[?ref=]` → `{version, base, rows, marcas, vers}`; `POST /api/desviacion/acuerdos`; `GET /api/desviacion/<ref>/historial`; `GET /api/desviacion/acuerdos.csv`.

- [ ] **Step 1: Pruebas que fallan** — en `tests/test_api.py`, antes de `# Límite de intentos`:

```python
# Desviación de previsiones
dv = c.get("/api/desviacion").json
check("desviación: versión vigente y acierto por versión", dv.get("version") == ds["meta"]["version"] and dv.get("vers") and all(x["e"] >= 0 for x in dv["vers"]), (dv.get("version"), len(dv.get("vers") or [])))
check("desviación: resumen con total primero", dv["marcas"][0]["mc"] == "Total" and dv["marcas"][0]["n"] == len(dv["rows"]), dv["marcas"][0])
prop = [p for p in dv["rows"] if p["tipo"] == "propuesta"]
k1, k2 = prop[0]["k"], prop[1]["k"]
acu = lambda items, motivo="", cl=c: cl.post("/api/desviacion/acuerdos", json={"items": items, "motivo": motivo}, headers=H)  # noqa: E731
check("acuerdo manual sin motivo se rechaza", acu([{"ref": k1, "src": "manual", "pct": -15}]).status_code == 400)
check("acuerdo manual fuera de rango se rechaza", acu([{"ref": k1, "src": "manual", "pct": -95}], "x").status_code == 400)
check("acuerdo fuera de ámbito se rechaza", acu([{"ref": "999999999999", "src": "mantener"}]).status_code == 400)
check("un lector no puede acordar", acu([{"ref": k1, "src": "mantener"}], cl=c2).status_code == 403)
r = acu([{"ref": k1, "src": "manual", "pct": -15}, {"ref": k2, "src": "propuesta"}], "Reunión; comercial\nNelly ñ €")
check("acuerdos guardados", r.status_code == 200 and r.json["n"] == 2, r.json)
a1 = c.get(f"/api/desviacion?ref={k1}").json["rows"][0]
check("acuerdo vigente aplicado a la previsión", a1["estado"] == "acordado" and a1["ca"] == -0.15 and a1["src"] == "manual", a1)
check("acuerdo de la propuesta", c.get(f"/api/desviacion?ref={k2}").json["rows"][0]["ca"] == prop[1]["cp"])
txt = c.get("/api/desviacion/acuerdos.csv").data.decode("latin-1")
lin = txt.split("\r\n")
check("CSV de acuerdos: cabecera con los meses", lin[0].startswith("Referencia;Mandante;Marca;Versión;Corrección %;Motivo;") and len(lin[0].split(";")) == 18, lin[0])
fila = next(x for x in lin if x.startswith(k1 + ";"))
check("CSV de acuerdos: % con coma y motivo limpio", fila.split(";")[4] == "-15" and ";" not in fila.split(";")[5] and len(fila.split(";")) == 18, fila)
h = c.get(f"/api/desviacion/{k1}/historial").json
check("historial del acuerdo con versión y autor", len(h) == 1 and h[0]["version"] == ds["meta"]["version"] and h[0]["by"], h)
con = sqlite3.connect(A.DB_PATH)
con.execute("UPDATE prev_dec SET version='2026Q3' WHERE ref=?", (k2,))
con.commit()
con.close()
check("acuerdo de otra versión no es vigente", c.get(f"/api/desviacion?ref={k2}").json["rows"][0]["estado"] != "acordado")
```

(`sqlite3` ya se importa en el bloque de parámetros; `c2` es el lector.)

- [ ] **Step 2: Ejecutar y ver que falla** — `DATA_DIR=$(mktemp -d) PYTHONIOENCODING=utf-8 python tests/test_api.py docs/MM_Supply.xlsx` → 404 / KeyError en "desviación: versión vigente".

- [ ] **Step 3: Implementar en `app.py`**

1. `import desviacion` junto a `import parametros`.
2. Al final de `SCHEMA`:

```sql
CREATE TABLE IF NOT EXISTS prev_dec(
  id INTEGER PRIMARY KEY, ref TEXT NOT NULL, md TEXT NOT NULL, version TEXT NOT NULL,
  pct REAL NOT NULL, src TEXT NOT NULL CHECK(src IN ('propuesta','manual','mantener')),
  motivo TEXT NOT NULL DEFAULT '', user_id INTEGER NOT NULL, created TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS prev_dec_ref ON prev_dec(ref, version, id);
```

3. Sección nueva antes de `# ---------------------------------------------------------------- notas y acciones`:

```python
# ---------------------------------------------------------------- desviación de previsiones
def _acuerdos(version: str) -> dict:
    """Acuerdo vigente (el último) de cada referencia para la versión de previsión dada."""
    q = ("SELECT d.* FROM prev_dec d JOIN (SELECT ref, MAX(id) AS id FROM prev_dec WHERE version=? GROUP BY ref) u "
         "ON u.id=d.id")
    return {r["ref"]: dict(r) for r in db().execute(q, (version,))}


def _desv(row) -> tuple[dict, list[dict]]:
    ds = json.loads(zlib.decompress(row["data"]))
    return ds, desviacion.filas(ds["refs"], _acuerdos(ds["meta"]["version"]))


@app.get("/api/desviacion")
@need()
def desv_list():
    row = _load_row()
    if not row:
        return jsonify({"empty": True})
    ds, rows = _desv(row)
    out = {"version": ds["meta"]["version"], "base": ds["meta"]["base"], "rows": rows,
           "marcas": desviacion.resumen_marcas(rows, ds["refs"]), "vers": ds["meta"].get("vers")}
    if request.args.get("ref"):
        out["rows"] = [p for p in rows if p["k"] == request.args["ref"]]
    return jsonify(out)


@app.post("/api/desviacion/acuerdos")
@need("admin", "planificador")
def desv_acordar():
    b = request.get_json(silent=True) or {}
    items, motivo = b.get("items"), (b.get("motivo") or "").strip()[:500]
    if not isinstance(items, list) or not 1 <= len(items) <= 1000:
        return err("Indica entre 1 y 1.000 referencias")
    row = _load_row()
    if not row:
        return err("No hay datos cargados")
    ds, rows = _desv(row)
    P = {p["k"]: p for p in rows}
    ins = []
    for it in items:
        p = P.get(it.get("ref")) if isinstance(it, dict) else None
        if not p:
            return err("Alguna referencia no está entre los productos contra stock con ABC de la carga vigente")
        src = it.get("src")
        if src == "propuesta":
            if p["cp"] is None:
                return err(f"{p['k']}: no tiene corrección propuesta (los métodos no coinciden o no hay datos)")
            pct = p["cp"]
        elif src == "mantener":
            pct = 0.0
        elif src == "manual":
            v = it.get("pct")
            if not (isinstance(v, (int, float)) and not isinstance(v, bool) and -90 <= v <= 300):
                return err("La corrección manual debe ser un porcentaje entre −90 y 300")
            if not motivo:
                return err("Indica el motivo de las correcciones manuales")
            pct = round(v / 100, 4)
        else:
            return err("Fuente no válida")
        ins.append((p["k"], p["md"], ds["meta"]["version"], pct, src, motivo, g.user["id"], now()))
    db().executemany("INSERT INTO prev_dec(ref,md,version,pct,src,motivo,user_id,created) VALUES(?,?,?,?,?,?,?,?)", ins)
    db().commit()
    return jsonify({"ok": True, "n": len(ins)})


@app.get("/api/desviacion/<ref>/historial")
@need()
def desv_historial(ref):
    if not REF_RE.fullmatch(ref):
        return err("La referencia no es válida")
    q = ("SELECT d.version,d.pct,d.src,d.motivo,d.created,u.name AS by FROM prev_dec d LEFT JOIN users u ON u.id=d.user_id "
         "WHERE d.ref=? ORDER BY d.id DESC")
    return jsonify([dict(r) for r in db().execute(q, (ref,))])


@app.get("/api/desviacion/acuerdos.csv")
@need()
def desv_csv():
    row = _load_row()
    if not row:
        return err("No hay datos cargados")
    ds, rows = _desv(row)
    y, m = map(int, ds["meta"]["base"].split("-"))
    meses = [f"{(m - 1 + i) % 12 + 1:02d}/{(y + (m - 1 + i) // 12) % 100:02d}" for i in range(12)]
    limpio = lambda s: " ".join((s or "").replace(";", ",").split())  # noqa: E731
    pct = lambda x: ("%g" % round(x * 100, 1)).replace(".", ",")  # noqa: E731
    lineas = ["Referencia;Mandante;Marca;Versión;Corrección %;Motivo;" + ";".join(meses)]
    A_ = _acuerdos(ds["meta"]["version"])
    for p in rows:
        if p["estado"] == "acordado":
            lineas.append(";".join([p["k"], p["md"], limpio(p["mc"]), ds["meta"]["version"], pct(p["ca"]), limpio(A_[p["k"]]["motivo"])] + [str(x) for x in p["pvc"]]))
    txt = "\r\n".join(lineas) + "\r\n"
    nombre = f'acuerdos_prevision_{ds["meta"]["version"]}_{today():%Y%m%d}.csv'
    return Response(txt.encode("latin-1", errors="replace"), mimetype="text/csv",
                    headers={"Content-Disposition": f'attachment; filename="{nombre}"'})
```

- [ ] **Step 4: Ejecutar** — `DATA_DIR=$(mktemp -d) PYTHONIOENCODING=utf-8 python tests/test_api.py docs/MM_Supply.xlsx` → `Todo correcto`.

- [ ] **Step 5: Commit**

```bash
git add app/app.py tests/test_api.py
git commit -m "Desviación de previsiones: acuerdos por versión con historial y CSV

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Pantalla "Desviación de previsiones"

**Files:**
- Modify: `app/static/app.js` (menú, `ROUTES`, `SOON`, página `pageDesv`)

**Interfaces:**
- Consumes: `GET /api/desviacion`, `POST /api/desviacion/acuerdos`, `/api/desviacion/acuerdos.csv`.
- Produces: ruta `#/desviacion` con query `mc, estado (por defecto propuesta,revisar), md, abc`; `DEST` (textos de estado).

- [ ] **Step 1: Menú y ruta** — en `shell()`: `const soon = [['consolidador', 'Consolidador de previsiones']];` y en el grupo `g2`, tras "Stock mínimo y lotes": `<a role="listitem" href="#/desviacion" data-nav="desviacion">Desviación de previsiones</a>`. `ROUTES`: `desviacion: pageDesv`. Borrar `'desviacion'` de `SOON`. En `markNav` no hace falta cambiar nada (la clave es `desviacion`; la antigua era `pronto/desviacion`).

- [ ] **Step 2: Página** — antes de `// ---------------------------------------------------------------- Usuarios (admin)`:

```js
// ---------------------------------------------------------------- Desviación de previsiones
const DEST = { propuesta: 'Con propuesta', revisar: 'Revisar con comercial', sin: 'Sin corrección', sin_dato: 'Sin datos', acordado: 'Acordado' };
const pctTxt = (x) => x == null ? '<span class="muted">—</span>' : (x > 0 ? '+' : '') + Math.round(x * 100) + ' %';
async function pageDesv(main) {
  if (!S.ds) return noData(main, 'Desviación de previsiones');
  const D = await api('/api/desviacion');
  if (D.empty) return noData(main, 'Desviación de previsiones');
  const canW = can('admin', 'planificador'), { q } = parseHash();
  const mc = q.get('mc') || '', estF = (q.get('estado') || 'propuesta,revisar').split(','), md = q.get('md') || '', abc = q.get('abc') || '';
  const xs = D.rows.filter(p => (!mc || p.mc === mc) && estF.includes(p.estado) && (!md || p.md === md) && (!abc || p.abc === abc))
    .sort((a, b) => Math.abs(b.ee) - Math.abs(a.ee) || Math.abs(b.eu) - Math.abs(a.eu));
  const vs = (D.vers || []).filter(x => !mc || x.mc === mc), V = {};
  vs.forEach(x => { const a = V[x.v] = V[x.v] || { e: 0, s: 0, p: 0, n: 0, m: 0 }; a.e += x.e; a.s += x.s; a.p += x.p; a.n += x.n; a.m = Math.max(a.m, x.m); });
  const ratio = (a, b) => b ? a / b : null, lim = 300;
  const opts = (vals, cur, all) => `<option value="">${all}</option>` + vals.map(v => `<option ${v === cur ? 'selected' : ''}>${esc(v)}</option>`).join('');
  const marcaFila = (x) => `<tr${x.mc === mc ? ' aria-current="true" class="sel"' : ''}><th scope="row">${x.mc === 'Total' ? '<a href="#/desviacion">Total</a>' : `<a href="#/desviacion?mc=${encodeURIComponent(x.mc)}">${esc(x.mc)}</a>`}</th>
    <td class="r num">${fmt(x.n)}</td><td class="r num">${fmt(x.p12)}</td><td class="r num">${fmt(x.v12)}</td><td class="r num">${pctTxt(x.dv)}</td><td class="r num">${pctTxt(x.sh)}</td><td class="r num">${x.er == null ? '—' : Math.round(x.er * 100) + ' %'}</td>
    <td class="r num">${fmt(x.prop)}</td><td class="r num">${fmt(x.rev)}</td><td class="r num">${fmt(x.acu)}</td><td class="r num">${fmt(x.eu)}</td><td class="r num">${eur(x.ee)}</td></tr>`;
  const ctl = (p) => canW ? `<td class="nowrap">${p.cp != null && p.cp !== 0 ? `<button class="btn ghost sm" data-acc="${esc(p.k)}">Aceptar</button> ` : ''}<input type="number" step="1" min="-90" max="300" data-pct="${esc(p.k)}" aria-label="Corrección en % de ${esc(p.k)}" style="width:70px"> <button class="btn ghost sm" data-otro="${esc(p.k)}">Otro %</button> <button class="btn ghost sm" data-man="${esc(p.k)}">Mantener</button></td>` : '';
  const fila = (p) => `<tr>${refCell({ k: p.k, n: p.n })}<td>${abcTag(p.abc)}</td><td class="r num">${fmt(p.p12)}</td><td class="r num">${fmt(p.v12)}</td><td class="r num">${pctTxt(p.cr)}</td><td class="r num">${pctTxt(p.cs)}</td>
    <td class="r num"><b>${p.estado === 'acordado' ? pctTxt(p.ca) : pctTxt(p.cp)}</b></td><td class="r num">${fmt(p.pvc.reduce((s, x) => s + x, 0))}</td><td class="r num">${p.pr > 0 ? eur(p.ee) : '<span class="muted">sin precio</span>'}</td><td class="nowrap">${DEST[p.estado]}</td>${ctl(p)}</tr>`;
  main.innerHTML = `<h1>Desviación de previsiones${mc ? ' · ' + esc(mc) : ''}</h1>
    <p class="lead">Contra stock con ABC · previsión ${esc(D.version)}. Corrección propuesta: la más prudente entre el ritmo de venta (venta de 12 meses frente a la previsión de 12 meses) y el sesgo histórico de la referencia; si se contradicen, revisar con comercial; menos del 10 %, sin corrección.</p>
    <div class="tw"><table class="fit"><caption class="sr">Desviación por marca</caption><thead><tr><th scope="col">Marca</th><th scope="col" class="r">Refs</th><th scope="col" class="r">Previsión 12 m</th><th scope="col" class="r">Venta 12 m</th><th scope="col" class="r">Previsión / venta</th><th scope="col" class="r">Sesgo pasado</th><th scope="col" class="r">Error pasado</th><th scope="col" class="r">Con propuesta</th><th scope="col" class="r">A revisar</th><th scope="col" class="r">Acordadas</th><th scope="col" class="r">Efecto uds</th><th scope="col" class="r">Efecto €</th></tr></thead>
      <tbody>${D.marcas.map(marcaFila).join('')}</tbody></table></div>
    <h2>Acierto por versión${mc ? ' · ' + esc(mc) : ''}</h2>
    ${D.vers ? `<div class="tw"><table class="fit"><thead><tr><th scope="col">Versión</th><th scope="col" class="r">Meses cerrados</th><th scope="col" class="r">Refs</th><th scope="col" class="r">Error</th><th scope="col" class="r">Sesgo</th></tr></thead><tbody>
      ${Object.keys(V).sort().map(v => `<tr><th scope="row">${esc(v)}</th><td class="r num">${V[v].m}</td><td class="r num">${fmt(V[v].n)}</td><td class="r num">${V[v].s ? Math.round(V[v].e / V[v].s * 100) + ' %' : '—'}</td><td class="r num">${pctTxt(ratio(V[v].p, V[v].s) == null ? null : V[v].p / V[v].s - 1)}</td></tr>`).join('') || '<tr><td colspan="5" class="empty">Sin versiones con meses cerrados.</td></tr>'}
      </tbody></table></div><p class="muted small">Error = Σ |venta − previsión| ÷ Σ venta en los meses cerrados que cubría cada versión desde el inicio de su trimestre. Sesgo positivo: se previó más de lo vendido.</p>` : '<p class="muted">Esta carga no trae el acierto por versión. Vuelve a cargar el MM_Supply desde Datos para verlo.</p>'}
    <h2>Para la reunión</h2>
    <form class="filters" id="dF" onsubmit="return false">
      <label class="fld">Estado<select name="estado">${[['propuesta,revisar', 'Con propuesta y a revisar'], ['propuesta', DEST.propuesta], ['revisar', DEST.revisar], ['acordado', DEST.acordado], ['sin', DEST.sin], ['sin_dato', DEST.sin_dato]].map(([v, t]) => `<option value="${v}" ${estF.join(',') === v ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
      <label class="fld">Mandante<select name="md">${opts(['Belloch', 'Yunsey'], md, 'Todos')}</select></label>
      <label class="fld">ABC<select name="abc">${opts(['A', 'B', 'C', 'D'], abc, 'Todas')}</select></label>
      ${canW ? `<label class="fld" style="flex:1 1 260px">Motivo (obligatorio con "Otro %")<input id="dMot" maxlength="500" value="${esc(S.dMot || '')}"></label>` : ''}
    </form>
    <div class="toolbar"><span class="count">${fmt(xs.length)} referencias${xs.length > lim ? ` · se muestran las ${lim} de más efecto` : ''}</span>
      ${canW && xs.some(p => p.estado === 'propuesta') ? `<button class="btn ghost sm" id="dBulk">Aceptar las ${fmt(xs.filter(p => p.estado === 'propuesta').length)} propuestas</button>` : ''}
      <a class="btn ghost sm" href="/api/desviacion/acuerdos.csv" download>Descargar acuerdos (CSV)</a></div>
    <div class="tw"><table><caption class="sr">Referencias para la reunión</caption><thead><tr><th scope="col">Referencia</th><th scope="col">ABC</th><th scope="col" class="r">Previsión 12 m</th><th scope="col" class="r">Venta 12 m</th><th scope="col" class="r">Ritmo</th><th scope="col" class="r">Sesgo</th><th scope="col" class="r">Propuesta · acordado</th><th scope="col" class="r">Previsión corregida</th><th scope="col" class="r">Efecto €</th><th scope="col">Estado</th>${canW ? '<th scope="col">Acuerdo</th>' : ''}</tr></thead>
      <tbody>${xs.slice(0, lim).map(fila).join('') || `<tr><td colspan="${canW ? 11 : 10}" class="empty">Nada con estos filtros.</td></tr>`}</tbody></table></div>
    <p class="muted small">Ritmo: venta de los 12 últimos meses cerrados ÷ previsión de los 12 próximos − 1. Sesgo: venta ÷ previsión vigente de los 12 meses pasados − 1 (solo con historia propia). Efecto a coste.</p>`;
  $('#dF').addEventListener('change', (ev) => { const n = ev.target.name; if (!n) return; setQuery({ [n]: ev.target.value }); pageDesv(main); });
  const mot = $('#dMot'); if (mot) mot.oninput = (ev) => { S.dMot = ev.target.value; };
  const enviar = async (items) => { try { const r = await api('/api/desviacion/acuerdos', { method: 'POST', body: { items, motivo: mot ? mot.value.trim() : '' } }); toast(`${r.n} ${r.n === 1 ? 'acuerdo guardado' : 'acuerdos guardados'}`); await pageDesv(main); } catch (e) { toast(e.message); } };
  $$('[data-acc]', main).forEach(b => b.onclick = () => enviar([{ ref: b.dataset.acc, src: 'propuesta' }]));
  $$('[data-man]', main).forEach(b => b.onclick = () => enviar([{ ref: b.dataset.man, src: 'mantener' }]));
  $$('[data-otro]', main).forEach(b => b.onclick = () => { const v = parseFloat(String($(`[data-pct="${CSS.escape(b.dataset.otro)}"]`, main).value).replace(',', '.')); if (isNaN(v)) { toast('Escribe la corrección en %'); return; } enviar([{ ref: b.dataset.otro, src: 'manual', pct: v }]); });
  const bulk = $('#dBulk'); if (bulk) bulk.onclick = () => { const its = xs.filter(p => p.estado === 'propuesta').map(p => ({ ref: p.k, src: 'propuesta' })); if (confirm(`¿Aceptar la propuesta en ${its.length} referencias?`)) enviar(its); };
}
```

En `app.css`, al final: `tr.sel th, tr.sel td{background:var(--soft)}`.

- [ ] **Step 3: Comprobar en la app** (instancia de prueba en 8010 con `shot.js`):
- Antes de republicar: la tabla de versiones dice "Vuelve a cargar el MM_Supply…" y el resto funciona.
- Republicar `docs/MM_Supply.xlsx`: tabla de versiones con 2024Q4…2026Q3.
- Tabla por marca con Total primero; pulsar NELLY filtra lista y versiones.
- Aceptar una propuesta, "Otro %" sin motivo (aviso), con motivo, "Mantener", y "Aceptar las N propuestas" en una marca.
- CSV: cabecera con 12 meses mm/aa; % con coma; abre en Excel.

- [ ] **Step 4: Commit**

```bash
git add app/static/app.js app/static/app.css
git commit -m "Pantalla de desviación de previsiones: por marca, acierto por versión y lista para la reunión

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Ficha (bloque Previsión)

**Files:**
- Modify: `app/static/app.js` (`pageRef`)

- [ ] **Step 1** — en `pageRef`, ampliar el `Promise.all` con `api('/api/desviacion?ref=' + encodeURIComponent(k))` y `api('/api/desviacion/' + encodeURIComponent(k) + '/historial')` (`const [notes, acts, par, hist, dvr, dvh] = ...`). Insertar antes de `<h2>Acierto de la previsión</h2>`:

```js
      ${(() => { const p = dvr && dvr.rows && dvr.rows[0]; if (!p) return '';
        const SRCD = { propuesta: 'propuesta', manual: 'manual', mantener: 'mantener' };
        return `<h2>Revisión de la previsión ${esc(dvr.version)}</h2>
        <div class="kpis"><div class="kpi"><div class="v">${fmt(p.p12)} · ${fmt(p.v12)}</div><div class="l">Previsión 12 m · venta 12 m</div></div>
          <div class="kpi"><div class="v">${pctTxt(p.cr)} · ${pctTxt(p.cs)}</div><div class="l">Ritmo · sesgo</div></div>
          <div class="kpi"><div class="v">${pctTxt(p.cp)}</div><div class="l">Propuesta (${DEST[p.tipo]})</div></div>
          <div class="kpi"><div class="v">${p.estado === 'acordado' ? pctTxt(p.ca) : '—'}</div><div class="l">${p.estado === 'acordado' ? 'Acordado · previsión corregida ' + fmt(p.pvc.reduce((s, x) => s + x, 0)) : 'Sin acuerdo · se decide en <a href="#/desviacion?mc=' + encodeURIComponent(p.mc) + '">Desviación</a>'}</div></div></div>
        ${dvh.length ? `<div class="tw"><table class="fit"><caption class="sr">Historial de acuerdos de previsión</caption><thead><tr><th scope="col">Fecha</th><th scope="col">Versión</th><th scope="col">Por</th><th scope="col" class="r">Corrección</th><th scope="col">Motivo</th></tr></thead><tbody>
          ${dvh.map(h => `<tr><td class="num">${fdt(h.created)}</td><td>${esc(h.version)}</td><td>${esc(h.by || '')}</td><td class="r num">${pctTxt(h.pct)} <span class="muted small">${SRCD[h.src]}</span></td><td>${esc(h.motivo)}</td></tr>`).join('')}</tbody></table></div>` : ''}`; })()}
```

- [ ] **Step 2: Comprobar en la app** — ficha de una referencia acordada en la Task 4: bloque con ritmo, sesgo, propuesta, acuerdo e historial; de una sin acuerdo: enlace a Desviación con su marca.

- [ ] **Step 3: Pruebas y commit** — `node -e "new Function(require('fs').readFileSync('app/static/app.js','utf8'))" && DATA_DIR=$(mktemp -d) PYTHONIOENCODING=utf-8 python tests/test_api.py docs/MM_Supply.xlsx` → sin errores; `Todo correcto`.

```bash
git add app/static/app.js
git commit -m "Ficha: revisión de la previsión con propuesta, acuerdo e historial

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: README

- [ ] **Step 1** — en `README.md`:
  - Tabla "Qué hace", tras "Stock mínimo y lotes": `| Desviación de previsiones | Todos (acuerdan planificador y administrador) | Desviación por marca (previsión frente a venta, sesgo y error pasados), acierto de cada versión trimestral y lista para la revisión con comercial con corrección propuesta, acuerdos por versión y CSV |`
  - "Lógica de cálculo": `- **Desviación de previsiones** (contra stock con ABC): ritmo = venta de los 12 últimos meses cerrados ÷ previsión de los 12 próximos − 1 (con 12 meses de venta, sin lanzamientos ni a extinguir); sesgo = factor de sesgo propio − 1. Propuesta: la menor si van en el mismo sentido, "revisar" si se contradicen, con tope ±50 % y sin corrección por debajo del 10 %; se aplica como % a los 12 meses de comercial. Los acuerdos van ligados a la versión de previsión. El acierto por versión compara cada versión con la venta real de los meses cerrados que cubría desde el inicio de su trimestre.`
  - Estructura: `  desviacion.py   desviación de previsiones (sin gemela en el navegador)` y `tests/test_desviacion.py pruebas de la desviación de previsiones: python tests/test_desviacion.py`.
  - "Pendiente": `- Módulo de consolidador (visible en el menú como "pronto").`
  - Roles: planificador `(notas, acciones y decisiones de stock mínimo, lote, plazo y previsión)`.

- [ ] **Step 2: Pruebas completas y commit** — las cinco baterías → `Todo correcto`.

```bash
git add README.md
git commit -m "README: desviación de previsiones

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
