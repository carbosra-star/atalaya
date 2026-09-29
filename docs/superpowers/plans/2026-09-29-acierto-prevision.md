# Acierto de la previsión en coberturas · plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Medir el acierto histórico de la previsión de cada referencia, poder proyectar con una previsión corregida por su sesgo, mostrar una cobertura prudente y enseñar el acierto en la ficha.

**Architecture:** Todo el cálculo nuevo se hace en `core.parse` (servidor) al leer el MM_Supply y se guarda en cada referencia del dataset (`hp`, `hm`, `fc`, `fo`, `er`, `eo`, `pvc`, `pv0rc`). `project`/`evaluate` (gemelos en `core.py` y `static/core.js`) reciben la previsión a usar, `"T"` o `"C"`. El navegador solo elige con un selector y pinta.

**Tech Stack:** Python 3.12 + Flask + SQLite; JS sin dependencias; pruebas con scripts Python (`assert`) y Node para la paridad.

**Spec:** `docs/superpowers/specs/2026-09-29-acierto-prevision-design.md`

## Global Constraints

- Ventana de acierto: los 12 últimos meses cerrados (índices −12 … −1).
- Factor propio solo con `hm ≥ 6`; si no, el del grupo (mandante, ABC); si no, 1. Siempre dentro de 0,5–1,5.
- Cobertura prudente = stock ÷ (demanda/mes corregida × (1 + min(error, 1))); informativa, no cambia el semáforo.
- Selector de previsión por defecto *tal cual* (`"T"`), guardado en `localStorage` con la clave `prev`.
- Fechas en números (`dd/mm/aaaa`, meses `mm/aa`); enteros con `fmt()` (punto de miles).
- Cualquier cambio en `project`/`evaluate` de `core.py` se replica en `static/core.js`; la paridad se comprueba en `tests/test_api.py`.
- Ficheros con finales de línea LF; comentarios y textos en español, con la densidad del código actual.

## Review Focus

1. **Cargas antiguas** (sin `pvc`/`hp`): con "Corregida" deben evaluarse como "tal cual" y la ficha debe explicar que falta el histórico, sin errores. → prueba en Task 2 y comprobación en Task 4.
2. **Referencia con historia pero sin venta** (`hm ≥ 6`, Σ venta = 0): factor limitado a 0,5 y error tomado del grupo, sin división por cero. → prueba en Task 1.
3. **Venta negativa** (devoluciones) en algún mes: el error usa |venta − previsión| y solo se calcula si Σ venta > 0. → prueba en Task 1.
4. **Valor raro en `localStorage.prev`**: cualquier cosa distinta de `"C"` se trata como `"T"`. → Task 3.
5. **Grupo sin ninguna referencia con historia**: factor 1, origen `"sin"`, error `null`, y la ficha lo dice. → prueba en Task 1.

---

### Task 1: Previsión vigente, factor de sesgo y error en `core.py`

**Files:**
- Modify: `app/core.py` (nuevas funciones `_resto`, `vigentes`, `acierto`; `parse` las usa)
- Create: `tests/test_core.py`

**Interfaces:**
- Produces:
  - `core.HMIN = 6`, `core.FMIN = 0.5`, `core.FMAX = 1.5`
  - `core._resto(p0: float, vendido: float, dq: int, dm: int) -> int`
  - `core.vigentes(cover: dict[str, set[int]], base_y: int, base_m: int, n: int = 12) -> list[str]` — versión vigente de los meses −n … −1 (lista de n textos, `""` si ninguna).
  - `core.acierto(refs: list[dict], dq: int, dm: int) -> None` — añade a cada ref `hm:int, fc:float, fo:str, er:float|None, eo:str, pvc:list[int], pv0rc:int`. Necesita en cada ref `md, abc, hp, vt, pv, v0`.
  - En el dataset: cada ref trae `hp` (12 enteros) y los campos de `acierto`; `meta.hist_src` (12 textos).

- [ ] **Step 1: Escribir las pruebas que fallan** — `tests/test_core.py`:

```python
"""Pruebas de la lógica de acierto de la previsión, con datos inventados (sin Excel).

Uso:  python tests/test_core.py
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "app"))
import core  # noqa: E402

fails = 0


def check(name, cond, detail=""):
    global fails
    print(("OK   " if cond else "FALLO"), name, detail)
    if not cond:
        fails += 1


def ref(k, md="Belloch", abc="A", hp=None, vt=None, pv=None, v0=0):
    return dict(k=k, md=md, abc=abc, hp=hp or [0] * 12, vt=vt or [0] * 12, pv=pv or [100] * 12, v0=v0)


# Previsión vigente: base 09/2026 (base_m = 8). Mes -8 = 01/2026, -4 = 05/2026, -1 = 08/2026
cover = {"2026Q1": set(range(-8, 4)), "2026Q2": set(range(-8, 4)), "2026Q3": set(range(-2, 4)), "2025Q4": set(range(-11, 4))}
v = core.vigentes(cover, 2026, 8)
check("01/26 sale de 2026Q1 aunque 2026Q2 lo cubra", v[-8 + 12] == "2026Q1", v)
check("05/26 sale de 2026Q2", v[-4 + 12] == "2026Q2")
check("08/26 sale de 2026Q3", v[-1 + 12] == "2026Q3")
check("09/25 sin versión vigente", v[0] == "", v[0])

# Factor propio, con límites
a = ref("a", hp=[100] * 12, vt=[90] * 12)
b = ref("b", hp=[100] * 12, vt=[300] * 12)
c = ref("c", hp=[100] * 12, vt=[10] * 12)
core.acierto([a, b, c], 30, 30)
check("factor propio 0,90", a["fc"] == 0.9 and a["fo"] == "ref", (a["fc"], a["fo"]))
check("factor limitado a 1,5", b["fc"] == 1.5)
check("factor limitado a 0,5", c["fc"] == 0.5)
check("error propio 120 / 1080", abs(a["er"] - round(120 / 1080, 3)) < 1e-9 and a["eo"] == "ref", a["er"])
check("previsión corregida", a["pvc"] == [90] * 12 and a["pv0rc"] == 90, (a["pvc"][:2], a["pv0rc"]))

# Pocos meses: factor y error del grupo (mandante, ABC)
g1 = ref("g1", hp=[100] * 12, vt=[80] * 12)
g2 = ref("g2", hp=[100] * 12, vt=[120] * 12)
nuevo = ref("n", hp=[0] * 9 + [100] * 3, vt=[0] * 9 + [500] * 3)
otro = ref("o", md="Yunsey", hp=[0] * 12, vt=[50] * 12)
core.acierto([g1, g2, nuevo, otro], 30, 30)
check("con 3 meses usa el grupo", nuevo["fo"] == "grupo" and nuevo["fc"] == 1.0 and nuevo["hm"] == 3, (nuevo["fc"], nuevo["fo"]))
check("error del grupo", nuevo["eo"] == "grupo" and abs(nuevo["er"] - 0.2) < 1e-9, nuevo["er"])
check("grupo sin historia: factor 1 y sin error", otro["fc"] == 1.0 and otro["fo"] == "sin" and otro["er"] is None and otro["eo"] == "sin")

# Historia sin venta y venta negativa
s = ref("s", hp=[100] * 12, vt=[0] * 12)
d = ref("d", hp=[100] * 12, vt=[100] * 11 + [-50])
core.acierto([g1, s, d], 30, 30)
check("sin venta: factor 0,5 y error del grupo", s["fc"] == 0.5 and s["eo"] == "grupo", (s["fc"], s["eo"]))
check("venta negativa: error con valor absoluto", abs(d["er"] - 150 / 1050) < 1e-9, d["er"])

# Resto del mes en curso corregido: 2 de 30 días, previsión 300 × 0,9 = 270, vendido 0 → 18
m = ref("m", hp=[100] * 12, vt=[90] * 12, pv=[300] + [100] * 11)
core.acierto([m], 2, 30)
check("resto del mes con previsión corregida", m["pv0rc"] == 18, m["pv0rc"])

print("\nTodo correcto" if not fails else f"\n{fails} comprobaciones fallidas")
sys.exit(1 if fails else 0)
```

- [ ] **Step 2: Ejecutarlas y ver que fallan**

Run: `python tests/test_core.py`
Expected: `AttributeError: module 'core' has no attribute 'vigentes'`

- [ ] **Step 3: Implementar** — en `app/core.py`:

Justo después de `H = 12 ...` y las constantes existentes:

```python
HMIN, FMIN, FMAX = 6, 0.5, 1.5  # acierto: meses mínimos de historia y límites del factor de sesgo
```

Antes de `def parse(`:

```python
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
```

En `parse`, tras calcular `src` y antes del bucle `for v, k, mi, r in pr:` que llena `PREV`, calcular la vigente y cambiar ese bucle para llenar también `HP`:

```python
    hsrc = vigentes(cover, base_y, base_m)
    HP: dict[str, list[float]] = {}  # previsión vigente de los 12 meses cerrados
```

y dentro del bucle, al principio:

```python
        if -12 <= mi < 0 and hsrc[mi + 12] == v:
            HP.setdefault(k, [0.0] * 12)[mi + 12] += _num(_get(r, iQ))
```

(el `continue` existente para meses fuera de 0..H−1 queda después de esta línea).

Sustituir la función anidada `resto_mes` por llamadas a `_resto`:

```python
    dias_mes = calendar.monthrange(today.year, today.month)[1]
    dias_quedan = dias_mes - today.day + 1
```

y en `refs.append(...)`: `pv0r=_resto(prev[0], v0, dias_quedan, dias_mes),` y añadir `hp=[round(x) for x in HP.get(k, [0.0] * 12)],`.

Después del bloque de ABC (tras `r.setdefault("abc", "D")`): `acierto(refs, dias_quedan, dias_mes)`.

En `meta`: añadir `hist_src=hsrc,`.

- [ ] **Step 4: Ejecutar las pruebas**

Run: `python tests/test_core.py` → Expected: `Todo correcto`
Run: `DATA_DIR=<vacía> python tests/test_api.py ../MM_Supply.xlsx` → Expected: `Todo correcto` (el semáforo no cambia todavía)

- [ ] **Step 5: Commit** — `git add app/core.py tests/test_core.py && git commit -m "Acierto de la previsión: previsión vigente, factor de sesgo y error"`

---

### Task 2: Evaluar con previsión tal cual o corregida (servidor y navegador)

**Files:**
- Modify: `app/core.py` (`project`, `evaluate`)
- Modify: `app/static/core.js` (`project`, `evaluate`, cobertura prudente)
- Modify: `app/app.py` (carga anterior en 6 combinaciones)
- Modify: `tests/test_core.py`, `tests/test_api.py`

**Interfaces:**
- Consumes: campos `pvc`, `pv0rc`, `er` de Task 1.
- Produces:
  - Python: `project(r, esc, pv="T")`, `evaluate(r, horizonte=3, escenario="ALL", prevision="T")`.
  - JS: `Cob.project(r, esc, pv)`, `Cob.evaluate(r, {horizonte, escenario, prevision})` → devuelve además `cobp` (cobertura prudente en meses; 99 = sin demanda con stock).
  - `/api/dataset` → `prev.sem` con claves `OF, OFPF, ALL, OF_C, OFPF_C, ALL_C`.

- [ ] **Step 1: Pruebas que fallan** — añadir al final de `tests/test_core.py`, antes del resumen:

```python
# Evaluación con previsión corregida y cargas antiguas sin pvc
base = dict(st=500, mn=0, at=0, en=[], pd=[0] * 12, pv=[100] * 12, pv0r=100)
nueva = dict(base, pvc=[50] * 12, pv0rc=50)
check("tal cual rompe en el mes 5", core.evaluate(nueva, 6, "ALL", "T")["rot"] == 5)
check("corregida rompe en el mes 10", core.evaluate(nueva, 6, "ALL", "C")["rot"] == 10)
check("carga antigua: corregida = tal cual", core.evaluate(base, 6, "ALL", "C") == core.evaluate(base, 6, "ALL", "T"))
```

En `tests/test_api.py`, cambiar la comprobación de la carga anterior y la paridad:

```python
check("carga anterior evaluada en las seis combinaciones", ds["prev"] and set(ds["prev"]["sem"]) == {"OF", "OFPF", "ALL", "OF_C", "OFPF_C", "ALL_C"})
```

```python
    out = {f"{e}{p}{h}": {r["k"]: core.evaluate(r, h, e, p)["sem"] for r in ds["refs"]}
           for e in ("OF", "OFPF", "ALL") for p in ("T", "C") for h in (1, 3, 6)}
    ...
        js = ("global.window={};require(process.argv[1]);const d=require(process.argv[2]);let n=0;"
              "for(const e of ['OF','OFPF','ALL'])for(const p of ['T','C'])for(const h of [1,3,6])for(const r of d.refs)"
              "if(window.Cob.evaluate(r,{horizonte:h,escenario:e,prevision:p}).sem!==d.py[e+p+h][r.k])n++;console.log(n)")
```

- [ ] **Step 2: Ejecutarlas y ver que fallan**

Run: `python tests/test_core.py` → Expected: `TypeError: evaluate() takes from 1 to 3 positional arguments but 4 were given`

- [ ] **Step 3: Implementar**

`app/core.py`:

```python
def project(r: dict, esc: str, pv: str = "T"):
    """pv: "T" previsión tal cual, "C" corregida por el sesgo (si la carga la trae)."""
    def inc(t):
        return t == "OF" or (esc != "OF" and t == "PF") or (esc == "ALL" and t == "P")

    p, p0 = (r["pvc"], r["pv0rc"]) if pv == "C" and "pvc" in r else (r["pv"], r["pv0r"])
    dem = [max(p0 if m == 0 else p[m], r["pd"][m]) for m in range(H)]
```

```python
def evaluate(r: dict, horizonte: int = 3, escenario: str = "ALL", prevision: str = "T") -> dict:
    hz = horizonte
    allp, ofp = project(r, escenario, prevision), project(r, "OF", prevision)
```

`app/static/core.js`:

```js
  function project(r, esc, pv) {
    const inc = (t) => counts(t, esc);
    const c = pv === 'C' && r.pvc, p = c ? r.pvc : r.pv, p0 = c ? r.pv0rc : r.pv0r;
    const dem = new Array(H), ent = new Array(H).fill(0), stk = new Array(H);
    for (let m = 0; m < H; m++) dem[m] = Math.max(m === 0 ? p0 : p[m], r.pd[m]);
```

```js
  function evaluate(r, cfg) {
    const hz = cfg.horizonte || 3, pv = cfg.prevision === 'C' ? 'C' : 'T';
    const all = project(r, cfg.escenario || 'ALL', pv), of = project(r, 'OF', pv);
```

y tras la línea de `cob`:

```js
    // Cobertura prudente (informativa): demanda corregida de los 3 próximos meses más el error medio, con tope del 100 %
    const dc = project(r, 'ALL', 'C').dem.slice(1, 4).reduce((s, x) => s + x, 0) / 3 * (1 + Math.min(r.er == null ? 0 : r.er, 1));
    const cobp = dc > 0 ? r.st / dc : (r.st > 0 ? 99 : 0);
```

añadiendo `cobp` al objeto devuelto.

`app/app.py`, en `dataset()`:

```python
                      "sem": {e + ("_C" if p == "C" else ""): {r["k"]: core.evaluate(r, hz, e, p)["sem"] for r in refs}
                              for e in ESCENARIOS for p in ("T", "C")}}
```

- [ ] **Step 4: Ejecutar las pruebas**

Run: `python tests/test_core.py` → `Todo correcto`
Run: `DATA_DIR=<vacía> python tests/test_api.py ../MM_Supply.xlsx` → `Todo correcto`, paridad `0 diferencias`

- [ ] **Step 5: Commit** — `git commit -am "Evaluación con previsión tal cual o corregida y cobertura prudente"`

---

### Task 3: Selector de previsión, textos, columna y CSV

**Files:**
- Modify: `app/static/app.js`

**Interfaces:**
- Consumes: `Cob.evaluate(r, {…, prevision})`, `e.cobp`, `r.fc`, `r.er`, `prev.sem[<clave>]` de Task 2.
- Produces: `S.pv` (`"T"`|`"C"`), `pvKey()` (clave de `prev.sem`), `cobTxt(v)` (formato de cobertura), selector con botones `[data-pv]`.

- [ ] **Step 1: Estado y textos.** En `S`: `pv: (() => { try { return localStorage.getItem('prev') === 'C' ? 'C' : 'T'; } catch (e) { return 'T'; } })()`. En `recompute()`: `const cfg = { horizonte: S.cfg.horizonte || 3, escenario: S.esc, prevision: S.pv };`. Junto a `escLower`:

```js
const PV = { T: 'Tal cual', C: 'Corregida' };
const pvKey = () => S.esc + (S.pv === 'C' ? '_C' : '');
const cobTxt = (v) => v >= 99 ? '—' : v.toLocaleString('es-ES', { maximumFractionDigits: 1 }) + ' m';
```

y `escLower` pasa a `() => ESC_TXT[S.esc] + (S.pv === 'C' ? ' y previsión corregida' : '')`.

- [ ] **Step 2: Selector.** `scenarioCtl()` devuelve los dos grupos:

```js
function scenarioCtl() {
  return `<div class="fld"><span id="escL">Entradas que se cuentan</span><div class="seg" role="group" aria-labelledby="escL">${Object.entries(ESC).map(([k, t]) => `<button type="button" data-esc="${k}" aria-pressed="${S.esc === k}">${k === 'OF' ? 'Solo OF' : k === 'OFPF' ? '+ fijadas' : '+ todas las propuestas'}<span class="sr"> (${t})</span></button>`).join('')}</div></div>
    <div class="fld"><span id="pvL">Previsión</span><div class="seg" role="group" aria-labelledby="pvL">${Object.entries(PV).map(([k, t]) => `<button type="button" data-pv="${k}" aria-pressed="${S.pv === k}">${t}</button>`).join('')}</div></div>`;
}
```

`bindScenario` enlaza también `[data-pv]` (guarda en `localStorage` con `try`, `recompute()`, `updateChrome()`, `rerender()`, `announce('Previsión: ' + PV[S.pv])`). En `pageList`, el `rerender` actualiza `aria-pressed` de `[data-esc]` y `[data-pv]`.

- [ ] **Step 3: Inicio.** `const prev = S.ds.prev ? (S.ds.prev.sem[pvKey()] || S.ds.prev.sem[S.esc]) : null;` (la segunda opción cubre respuestas de servidores anteriores).

- [ ] **Step 4: Coberturas y CSV.** `LIST_GET.cobp = x => x.e.cobp`; cabecera `${thSort('Cob. prudente', 'cobp', key, dir, 'r')}` tras "Cobertura"; celda `<td class="r num">${cobTxt(e.cobp)}</td>`; la celda de cobertura usa `cobTxt(e.cob)`; `colspan` de la fila vacía pasa a 11. CSV: tras `'Cobertura meses'` añadir `'Cobertura prudente meses', 'Factor sesgo', 'Error previsión %'` con valores `e.cobp >= 99 ? '' : e.cobp.toFixed(1).replace('.', ',')`, `r.fc == null ? '' : String(r.fc).replace('.', ',')`, `r.er == null ? '' : Math.round(r.er * 100)`.

- [ ] **Step 5: Comprobar.** `node --check app/static/app.js`; arrancar la app con la base de pruebas y, en el navegador, cambiar a "Corregida" en Coberturas: el recuento cambia, la columna se ordena, el CSV trae las tres columnas y no hay errores en consola. Con `localStorage.prev = 'x'` la app arranca en "Tal cual".

- [ ] **Step 6: Commit** — `git commit -am "Selector de previsión tal cual/corregida y cobertura prudente en la lista"`

---

### Task 4: Ficha: cobertura prudente y acierto de la previsión

**Files:**
- Modify: `app/static/app.js` (`pageRef`, nueva `aciertoHTML`)
- Modify: `app/static/app.css` (`.kpis` flexible)

**Interfaces:**
- Consumes: `r.hp, r.hm, r.fc, r.fo, r.er, r.eo, r.pvc, r.pv0rc`, `S.ds.meta.hist_src`, `e.cobp`, `cobTxt`, `S.pv`.

- [ ] **Step 1: Sección de acierto.**

```js
// Acierto de la previsión de los 12 últimos meses cerrados frente a la venta real
function aciertoHTML(r) {
  if (!r.hp) return '<p class="muted">Esta carga no trae el histórico de previsión. Vuelve a cargar el MM_Supply para verlo.</p>';
  const pct = (x) => Math.round(x * 100) + ' %', sv = r.vt.reduce((s, x) => s + x, 0), sp = r.hp.reduce((s, x) => s + x, 0);
  const grupo = `de su grupo ${esc(r.md)} · ${esc(r.abc)}`;
  const orig = r.fo === 'ref' ? 'propio' : r.fo === 'grupo' ? grupo : 'sin datos, no se corrige';
  const txt = (r.hm >= 6 && sp > 0 ? `En 12 meses se vendió el ${pct(sv / sp)} de lo previsto. ` : `Solo ${r.hm} de 12 meses con previsión: no basta para un factor propio. `) +
    `Error medio mes a mes: ${r.er == null ? 'sin dato' : pct(r.er) + (r.eo === 'grupo' ? ' (' + grupo + ')' : '')}. Factor de corrección: ${String(r.fc).replace('.', ',')} (${orig}).`;
  const src = S.ds.meta.hist_src || [];
  return `<p>${txt}</p><div class="tw"><table class="mt"><caption class="sr">Previsión vigente y venta de los 12 últimos meses</caption><thead><tr><th scope="col">Unidades</th>${r.hp.map((_, i) => `<th scope="col" class="r">${monthLabel(i - 12)}</th>`).join('')}</tr></thead><tbody>
    <tr><th scope="row">Previsión vigente</th>${r.hp.map(v => `<td class="r num">${fmt(v)}</td>`).join('')}</tr>
    <tr><th scope="row">Venta</th>${r.vt.map(v => `<td class="r num">${fmt(v)}</td>`).join('')}</tr>
    <tr><th scope="row">Desviación</th>${r.hp.map((p, i) => `<td class="r num ${p > 0 && Math.abs(r.vt[i] - p) / p > 0.3 ? 'neg' : ''}">${p > 0 ? pct((r.vt[i] - p) / p) : ''}</td>`).join('')}</tr>
    <tr><th scope="row">Versión</th>${src.map(v => `<td class="r small muted">${esc(v)}</td>`).join('')}</tr></tbody></table></div>`;
}
```

- [ ] **Step 2: Integrarla en `pageRef`.** Añadir el KPI tras el de cobertura: `<div class="kpi"><div class="v">${cobTxt(e.cobp)}</div><div class="l">Cobertura prudente (previsión corregida)</div></div>`; el KPI de cobertura usa `cobTxt(e.cob)`. La fila "Previsión" de "Mes a mes" muestra la previsión elegida: `const pvA = S.pv === 'C' && r.pvc ? r.pvc : r.pv, pv0A = S.pv === 'C' && r.pvc ? r.pv0rc : r.pv0r;` y `${pvA.map((v, i) => `<td class="r num">${fmt(i === 0 ? pv0A : v)}</td>`).join('')}`, con la cabecera de fila `Previsión${S.pv === 'C' && r.pvc ? ' corregida' : ''}`. Tras la nota del mes en curso: `<h2>Acierto de la previsión</h2>${aciertoHTML(r)}`.

- [ ] **Step 3: CSS.** `.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px;margin:14px 0}` y quitar `.kpis{…}` de la media query de 980px.

- [ ] **Step 4: Comprobar en el navegador** la ficha de 010010001200 (factor propio), una referencia con `fo = "grupo"` y otra con `fo = "sin"`: frase correcta, tabla con 12 meses y versiones, KPIs en una fila a 1400 px y sin errores. Con una carga antigua (sin `hp`) sale el aviso.

- [ ] **Step 5: Commit** — `git commit -am "Ficha: cobertura prudente y acierto de la previsión"`

---

### Task 5: Documentación y verificación final

**Files:**
- Modify: `README.md` (y su copia `../README.md`)

- [ ] **Step 1: README.** En "Lógica de cálculo" añadir:

```markdown
- **Acierto de la previsión**: para los 12 últimos meses cerrados se compara la venta con la previsión vigente de cada mes (la última versión cuyo trimestre había empezado). El **factor de sesgo** es venta ÷ previsión, propio con 6 meses o más de historia o, si no, el de su grupo mandante × ABC, siempre entre 0,5 y 1,5. El **error medio** es Σ|venta − previsión| ÷ venta.
- **Previsión corregida** (selector "Previsión"): la previsión × factor de sesgo. Por defecto se usa la previsión tal cual.
- **Cobertura prudente**: stock ÷ (demanda/mes con previsión corregida × (1 + error medio, con tope del 100 %)). Es informativa, no cambia el semáforo.
```

En "Deuda técnica": `- **Acierto y corrección de la previsión (provisional)**: parámetros fijos (12 meses, 6 meses mínimos, límites 0,5–1,5, grupo mandante × ABC). Se revisarán con el módulo de desviación de previsiones y el de stock mínimo.` y en "Estructura" la línea `tests/test_core.py pruebas de la lógica con datos inventados: python tests/test_core.py`.

- [ ] **Step 2: Verificación completa.** `python tests/test_core.py`, `DATA_DIR=<vacía> python tests/test_api.py ../MM_Supply.xlsx`, recorrido en el navegador de Inicio, Coberturas, ficha y Reunión en los dos modos de previsión, sin errores de consola.

- [ ] **Step 3: Commit** — `git commit -am "README: acierto de la previsión, previsión corregida y cobertura prudente"`
