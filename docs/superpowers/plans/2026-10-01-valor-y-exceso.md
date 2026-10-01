# Valor en € y exceso de stock · plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Añadir el estado de semáforo "Exceso" (stock > demanda de 6 meses Belloch / 12 meses Yunsey) y el valor en € (stock, exceso, sin demanda, rotura) en Inicio, Coberturas, Ficha y Porfolio.

**Architecture:** La regla vive en `evaluate` de `app/core.py` y su gemela `app/static/core.js`, que reciben un parámetro nuevo `exceso` ({mandante: meses}) y devuelven además `ex` (unidades en exceso) y `fa` (unidades que faltan en el horizonte). La configuración se guarda en la tabla `config` (clave `exceso`) vía `/api/config`. El € se calcula en el navegador con `r.pr` (ya está en el dataset); solo Porfolio necesita añadir `pr` a sus filas en el servidor.

**Tech Stack:** Python 3.13 + Flask + SQLite; JavaScript de navegador sin framework; pruebas con scripts propios (`tests/test_core.py`, `tests/test_core_js.js`, `tests/test_api.py`).

**Spec:** `docs/superpowers/specs/2026-10-01-valor-y-exceso-design.md`

## Global Constraints

- Idioma de la app, mensajes, comentarios y commits: español.
- `core.py` y `core.js` son gemelas: cualquier cambio en `evaluate` va en las dos y deben dar el mismo `sem`.
- Exceso solo para `gp == "Contra Stock"` y solo si la referencia habría quedado en `verde`.
- Exceso por defecto: `{"Belloch": 6, "Yunsey": 12}`; valores válidos: enteros 1–12.
- Precio = `r.pr` (`Precio Mixto`, a coste). Referencia con stock > 0 y `pr == 0` → "sin precio", no suma en totales.
- Formato de €: enteros con punto de miles (`fmt`) + " €"; en Inicio en miles: "326 k€".
- Fechas siempre en números (dd/mm/aaaa, meses mm/aa).
- Mirada macro: no añadir más columnas ni pantallas que las del spec.
- Pruebas: `python tests/test_core.py`, `node tests/test_core_js.js`, y `DATA_DIR=<carpeta vacía> python tests/test_api.py docs/MM_Supply.xlsx` (desde la raíz del repo; usar una carpeta del scratchpad o `mktemp -d`).
- Commits pequeños, uno por tarea, terminados en `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

- Mandante sin clave en `cfg.exceso` (configuración antigua guardada sin `exceso`, o `S.cfg` sin cargar): debe usar el valor por defecto (6/12), no fallar ni marcar todo como exceso. → prueba en Task 1 (`exceso=None`) y Task 2 (`get_config` sin clave).
- Stock negativo o 0 con demanda: nunca exceso, y `fa` es la falta del peor mes. → prueba en Task 1.
- Referencia en Exceso con `pr == 0`: la columna Valor muestra "sin precio" y la fila no rompe la ordenación (valor −1 para ordenar al final). → Task 4, comprobación manual en la app.
- Cargas antiguas publicadas sin `pr` en `porfolio.inact`: "—" en la columna Valor, sin errores. → Task 5.
- Cambiar los meses de exceso en Datos debe recalcular el semáforo al instante en el navegador (sin recargar la página) y lo usan también el resumen de la carga y la comparación con la carga anterior. → Task 2 (servidor) y Task 3 (navegador).

---

### Task 1: Regla de exceso y faltante en `evaluate` (Python y JS)

**Files:**
- Modify: `app/core.py` (constantes al principio; `evaluate`, ~líneas 549–593)
- Modify: `app/static/core.js` (`evaluate`, ~líneas 30–58)
- Test: `tests/test_core.py` (al final, antes del resumen), `tests/test_core_js.js` (antes del resumen)

**Interfaces:**
- Produces (Python): `core.EXCESO_DEF = {"Belloch": 6, "Yunsey": 12}`; `core.evaluate(r, horizonte=3, escenario="ALL", prevision="T", exceso=None) -> {"sem", "why", "rot", "ex", "fa"}`. `sem` puede valer `"exceso"`.
- Produces (JS): `Cob.evaluate(r, cfg)` lee `cfg.exceso` (objeto `{Belloch, Yunsey}`, opcional) y devuelve además `ex` y `fa`; `Cob.EXCESO_DEF`.
- `r.md` es "Belloch" o "Yunsey"; si falta, se toma "Belloch".

- [ ] **Step 1: Pruebas que fallan en `tests/test_core.py`**

Añadir antes de `print("\nTodo correcto" ...)`:

```python
# Exceso: stock por encima de la demanda de los próximos N meses (Belloch 6, Yunsey 12), solo contra stock
exb = dict(base, gp="Contra Stock", md="Belloch", st=700, pv=[100] * 12, pv0r=100)
r1 = core.evaluate(exb, 3, "ALL")
check("exceso Belloch: 700 > 6 × 100", r1["sem"] == "exceso" and r1["ex"] == 100 and r1["why"] == "Stock para más de 6 meses", r1)
check("exceso: en el límite no hay exceso", core.evaluate(dict(exb, st=600), 3, "ALL")["sem"] == "verde")
exy = dict(exb, md="Yunsey", st=1100)
check("Yunsey a 12 meses: 1100 no es exceso", core.evaluate(exy, 3, "ALL")["sem"] == "verde")
check("Yunsey a 12 meses: 1300 sí", core.evaluate(dict(exy, st=1300), 3, "ALL")["ex"] == 100)
check("meses de exceso configurables", core.evaluate(exb, 3, "ALL", "T", {"Belloch": 3, "Yunsey": 12})["ex"] == 400)
check("configuración incompleta usa el valor por defecto", core.evaluate(exb, 3, "ALL", "T", {"Yunsey": 12})["ex"] == 100)
check("bajo pedido nunca es exceso", core.evaluate(dict(exb, gp="Bajo Pedido"), 3, "ALL")["sem"] == "verde")
check("sin demanda sigue en gris", core.evaluate(dict(exb, pv=[0] * 12, pv0r=0), 3, "ALL")["sem"] == "gris")
check("bajo mínimo manda sobre el exceso", core.evaluate(dict(exb, mn=800), 3, "ALL")["sem"] == "naranja")
check("OF atrasada manda sobre el exceso", core.evaluate(dict(exb, en=[dict(t="OF", q=10, m=0, d="2026-09-01", late=True)]), 3, "ALL")["sem"] == "amarillo")
exc = dict(exb, st=500, pvc=[50] * 12, pv0rc=50)
check("con la previsión corregida aparece el exceso", core.evaluate(exc, 3, "ALL", "C")["ex"] == 200 and core.evaluate(exc, 3, "ALL", "T")["ex"] == 0)
check("sin exceso, ex = 0", core.evaluate(dict(exb, st=100), 3, "ALL")["ex"] == 0)
# Faltante: lo que falta en el peor mes del horizonte
fal = dict(exb, st=150)
check("faltante en el horizonte de 3 meses", core.evaluate(fal, 3, "ALL")["fa"] == 150, core.evaluate(fal, 3, "ALL"))
check("faltante con stock negativo", core.evaluate(dict(fal, st=-50), 3, "ALL")["fa"] == 350)
check("sin rotura en el horizonte, faltante 0", core.evaluate(exb, 3, "ALL")["fa"] == 0)
```

(`base` ya está definida más arriba: `dict(st=500, mn=0, at=0, en=[], pd=[0] * 12, pv=[100] * 12, pv0r=100)`.)

Cuentas: Belloch 6 meses → demanda 0…5 = 600; 700 − 600 = 100. Con N=3 → 700 − 300 = 400. Faltante: stock 150, demanda 100/mes, horizonte 3 → stock fin de mes 50, −50, −150 → peor −150 → `fa = 150`; con st −50 → −150, −250, −350 → 350.

- [ ] **Step 2: Ejecutar y ver que fallan**

Run: `python tests/test_core.py`
Expected: las comprobaciones nuevas en `FALLO` (KeyError `ex`/`fa` o `sem` distinto), las anteriores en `OK`.

- [ ] **Step 3: Implementar en `app/core.py`**

Junto a las constantes del principio (después de `ABC_VIDA, ABC_MIN = ...`):

```python
EXCESO_DEF = {"Belloch": 6, "Yunsey": 12}  # exceso: stock para más de N meses de demanda (provisional hasta el módulo de stock mínimo)
```

En `evaluate`, cambiar la firma y el final:

```python
def evaluate(r: dict, horizonte: int = 3, escenario: str = "ALL", prevision: str = "T", exceso: dict | None = None) -> dict:
```

Sustituir `return {"sem": sem, "why": why, "rot": rot}` por:

```python
    # Exceso: lo que seguiría en el almacén pasados N meses sin fabricar nada más (solo contra stock)
    n = int((exceso or {}).get(r.get("md") or "Belloch") or EXCESO_DEF.get(r.get("md") or "Belloch", 6))
    ex = max(0, round(r["st"] - sum(allp["dem"][:n])))
    if sem == "verde" and cs and ex > 0:
        sem, why = "exceso", f"Stock para más de {n} meses"
    if sem != "exceso":
        ex = 0
    # Faltante: lo que falta en el peor mes del horizonte con el escenario de entradas elegido
    fa = max(0, round(-min(allp["stk"][:hz])))
    return {"sem": sem, "why": why, "rot": rot, "ex": ex, "fa": fa}
```

- [ ] **Step 4: Ejecutar las pruebas de Python**

Run: `python tests/test_core.py`
Expected: `Todo correcto`.

- [ ] **Step 5: Pruebas que fallan en `tests/test_core_js.js`**

Añadir antes de `console.log(fails ? ...)`:

```js
// Exceso y faltante (gemelos de core.py, ver test_core.py)
const exb = { ...base, gp: 'Contra Stock', md: 'Belloch', st: 700 };
check('exceso Belloch', evaluate(exb, cfg).sem === 'exceso' && evaluate(exb, cfg).ex === 100 && evaluate(exb, cfg).why === 'Stock para más de 6 meses', evaluate(exb, cfg));
check('exceso: en el límite no hay exceso', evaluate({ ...exb, st: 600 }, cfg).sem === 'verde');
check('Yunsey a 12 meses', evaluate({ ...exb, md: 'Yunsey', st: 1100 }, cfg).sem === 'verde' && evaluate({ ...exb, md: 'Yunsey', st: 1300 }, cfg).ex === 100);
check('meses de exceso configurables', evaluate(exb, { ...cfg, exceso: { Belloch: 3, Yunsey: 12 } }).ex === 400);
check('configuración incompleta usa el valor por defecto', evaluate(exb, { ...cfg, exceso: { Yunsey: 12 } }).ex === 100);
check('bajo pedido nunca es exceso', evaluate({ ...exb, gp: 'Bajo Pedido' }, cfg).sem === 'verde');
check('bajo mínimo manda sobre el exceso', evaluate({ ...exb, mn: 800 }, cfg).sem === 'naranja');
check('faltante en el horizonte', evaluate({ ...exb, st: 150 }, cfg).fa === 150 && evaluate({ ...exb, st: -50 }, cfg).fa === 350 && evaluate(exb, cfg).fa === 0);
```

(`base` en este fichero: `st: 300, mn: 0, at: 0, en: [], pd: 12×0, pv: 12×100, pv0r: 100`; `cfg = { horizonte: 3, escenario: 'ALL', prevision: 'T' }`.)

- [ ] **Step 6: Ejecutar y ver que fallan**

Run: `node tests/test_core_js.js`
Expected: las nuevas en `FALLO`.

- [ ] **Step 7: Implementar en `app/static/core.js`**

Debajo de `const SIN_ENT_MESES = 6;`:

```js
  const EXCESO_DEF = { Belloch: 6, Yunsey: 12 };  // exceso: stock para más de N meses de demanda (gemela de core.EXCESO_DEF)
```

En `evaluate`, justo antes de `return { all, of, ... }`:

```js
    // Exceso: lo que seguiría en el almacén pasados N meses sin fabricar nada más (solo contra stock)
    const md = r.md || 'Belloch', n = Math.trunc((cfg.exceso && cfg.exceso[md]) || EXCESO_DEF[md] || 6);
    let ex = Math.max(0, Math.round(r.st - all.dem.slice(0, n).reduce((s, x) => s + x, 0)));
    if (sem === 'verde' && cs && ex > 0) { sem = 'exceso'; why = `Stock para más de ${n} meses`; }
    if (sem !== 'exceso') ex = 0;
    // Faltante: lo que falta en el peor mes del horizonte con el escenario de entradas elegido
    const fa = Math.max(0, Math.round(-Math.min(...all.stk.slice(0, hz))));
```

Y añadir `ex, fa` al objeto devuelto: `return { all, of, rot, bmin, rotOF, cob, cobp, next, lateOF, sem, why, d3, d12, ex, fa };`. Exportar: `root.Cob = { project, evaluate, H, EXCESO_DEF };`.

Nota de paridad de redondeo: Python `round` redondea .5 al par y JS `Math.round` hacia arriba; `ex` y `fa` solo se usan para mostrar y la decisión de `sem` usa `ex > 0` sobre valores que vienen de enteros (`st`, `dem` ya redondeados salvo `pvc`), así que no afecta al estado. No cambiar.

- [ ] **Step 8: Ejecutar las dos baterías**

Run: `node tests/test_core_js.js && python tests/test_core.py`
Expected: `Todo correcto` en las dos.

- [ ] **Step 9: Commit**

```bash
git add app/core.py app/static/core.js tests/test_core.py tests/test_core_js.js
git commit -m "Semáforo: estado de exceso y faltante en el horizonte

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Configuración del exceso en el servidor

**Files:**
- Modify: `app/app.py` (`get_config` ~137; `dataset` ~278–283; `upload` ~321–322; `config` ~344–378)
- Test: `tests/test_api.py` (bloque "Parámetros del ABC desde la app" y bloque de paridad)

**Interfaces:**
- Consumes: `core.EXCESO_DEF`, `core.evaluate(..., exceso=...)` de Task 1.
- Produces: `get_config()["exceso"]` siempre presente (`{"Belloch": int, "Yunsey": int}`); `PUT /api/config` con `{"exceso": {...}}`; respuesta = configuración completa.

- [ ] **Step 1: Pruebas que fallan en `tests/test_api.py`**

Después de `check("el horizonte se sigue guardando aparte", ...)`:

```python
# Meses de exceso por mandante
check("exceso por defecto 6/12", cfg.get("exceso") == {"Belloch": 6, "Yunsey": 12}, cfg.get("exceso"))
r = c.put("/api/config", json={"exceso": {"Belloch": 4, "Yunsey": 9}}, headers=H)
check("guardar meses de exceso", r.status_code == 200 and r.json["exceso"] == {"Belloch": 4, "Yunsey": 9}, r.json)
for malo in ({"Belloch": 0, "Yunsey": 12}, {"Belloch": 13, "Yunsey": 12}, {"Belloch": 6.5, "Yunsey": 12}, {"Belloch": 6}, "6", {"Belloch": True, "Yunsey": 12}):
    check(f"exceso no válido se rechaza: {malo}", c.put("/api/config", json={"exceso": malo}, headers=H).status_code == 400)
nexc = lambda: sum(v == "exceso" for v in c.get("/api/dataset").json["prev"]["sem"]["ALL"].values())  # noqa: E731
n9 = nexc()
c.put("/api/config", json={"exceso": {"Belloch": 6, "Yunsey": 12}}, headers=H)
check("la carga anterior se evalúa con los meses de exceso guardados", nexc() < n9, (n9, nexc()))
```

(Con menos meses hay más exceso, así que con 4/9 salen más referencias que con 6/12.)

En el bloque de paridad, pasar el exceso guardado a los dos lados. Cambiar:

```python
    out = {f"{e}{p}{h}": {r["k"]: core.evaluate(r, h, e, p)["sem"] for r in ds["refs"]}
```
por
```python
    exc = c.get("/api/me").json["config"]["exceso"]
    out = {f"{e}{p}{h}": {r["k"]: core.evaluate(r, h, e, p, exc)["sem"] for r in ds["refs"]}
```
y en la cadena `js`, `json.dump({"refs": ds["refs"], "py": out}, ...)` por `json.dump({"refs": ds["refs"], "py": out, "exc": exc}, ...)` y `window.Cob.evaluate(r,{horizonte:h,escenario:e,prevision:p})` por `window.Cob.evaluate(r,{horizonte:h,escenario:e,prevision:p,exceso:d.exc})`. Añadir tras la paridad:

```python
    check("hay referencias en exceso con los datos reales", sum(v == "exceso" for v in out["ALLT3"].values()) > 50, sum(v == "exceso" for v in out["ALLT3"].values()))
```

- [ ] **Step 2: Ejecutar y ver que fallan**

Run (bash): `DATA_DIR=$(mktemp -d) python tests/test_api.py docs/MM_Supply.xlsx`
Expected: `FALLO` en "exceso por defecto 6/12" y siguientes.

- [ ] **Step 3: Implementar en `app/app.py`**

`get_config`:

```python
def get_config() -> dict:
    cfg = {"horizonte": 3, "abc": json.loads(json.dumps(core.ABC_DEF)), "exceso": dict(core.EXCESO_DEF)}
    for r in db().execute("SELECT key,value FROM config"):
        cfg[r["key"]] = json.loads(r["value"])
    return cfg
```

En `config()`:
- Cambiar `if "horizonte" not in b and "abc" not in b:` por `if not any(k in b for k in ("horizonte", "abc", "exceso")):`.
- Antes de `antes = get_config()["abc"]["cortes"]`, añadir:

```python
    if "exceso" in b:
        ex = b["exceso"]
        ok = isinstance(ex, dict) and all(isinstance(ex.get(md), int) and not isinstance(ex.get(md), bool) and 1 <= ex[md] <= 12 for md in ("Belloch", "Yunsey"))
        if not ok:
            return err("Los meses de exceso deben ser números enteros entre 1 y 12 para Belloch y Yunsey")
        save["exceso"] = {md: ex[md] for md in ("Belloch", "Yunsey")}
```

En `dataset()` (comparación con la carga anterior), sustituir `hz = get_config().get("horizonte", 3)` y la llamada:

```python
        cfg = get_config()
        hz, exc = cfg.get("horizonte", 3), cfg["exceso"]
        ds["prev"] = {"id": prev["id"], "created": prev["created"], "hoy": prev["hoy"],
                      "sem": {e + ("_C" if p == "C" else ""): {r["k"]: core.evaluate(r, hz, e, p, exc)["sem"] for r in refs}
                              for e in ESCENARIOS for p in ("T", "C")}}
```

En `upload()`:

```python
    cfg = get_config()
    sem = {r["k"]: core.evaluate(r, cfg.get("horizonte", 3), "ALL", "T", cfg["exceso"])["sem"] for r in ds["refs"]}
```

- [ ] **Step 4: Ejecutar la prueba de extremo a extremo**

Run (bash): `DATA_DIR=$(mktemp -d) python tests/test_api.py docs/MM_Supply.xlsx`
Expected: `Todo correcto`, incluida "core.js evalúa igual que core.py" (si hay Node) y "hay referencias en exceso con los datos reales".

- [ ] **Step 5: Commit**

```bash
git add app/app.py tests/test_api.py
git commit -m "Meses de exceso por mandante en la configuración

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: El estado Exceso en pantalla y su configuración en Datos

**Files:**
- Modify: `app/static/app.js` (constantes `SEM`/`SEMORD` ~16–18; `recompute` ~83; `semCorto` ~232; `pageData` ~559–583)
- Modify: `app/static/app.css` (variables de color líneas 3–4, 13–14, 19–20; clases `.s-*` línea 76)

**Interfaces:**
- Consumes: `S.cfg.exceso` (de `/api/me` y de `PUT /api/config`), `e.sem === 'exceso'`, `e.why`.
- Produces: `SEM` con `['exceso', 'Exceso']`; clase CSS `.s-exceso`.

- [ ] **Step 1: Constantes del semáforo**

```js
const SEM = [['rojo', 'Rotura'], ['naranja', 'Bajo mínimo'], ['amarillo', 'A revisar'], ['verde', 'Cubierto'], ['exceso', 'Exceso'], ['gris', 'Sin demanda']];
const SEMT = Object.fromEntries(SEM);
const SEMORD = { rojo: 0, naranja: 1, amarillo: 2, verde: 3, exceso: 4, gris: 5 };
```

En `semCorto`, la última línea: `return { naranja: 'Bajo mínimo', verde: 'Cubierto', exceso: 'Exceso', gris: 'Sin demanda' }[e.sem];`

- [ ] **Step 2: Pasar los meses de exceso a la evaluación**

En `recompute`:

```js
  const cfg = { horizonte: S.cfg.horizonte || 3, escenario: S.esc, prevision: S.pv, exceso: S.cfg.exceso };
```

- [ ] **Step 3: Color propio (azul violáceo, distinto del azul de enlaces y entradas)**

En `app.css`, añadir a la línea de variables claras (línea 3) `--exceso:#4F5BB5;` y a la de fondos (línea 4) `--excesoBg:#E3E5F6;`. En los dos bloques oscuros (líneas 13–14 y 19–20) `--exceso:#9AA4F0;` y `--excesoBg:#23263F;`. En la línea 76 añadir `.s-exceso{--c:var(--exceso);--cb:var(--excesoBg)}`.

Comprobar contraste: el texto de la insignia usa `--c` sobre `--cb`; #4F5BB5 sobre #E3E5F6 ≈ 5,3:1 y #9AA4F0 sobre #23263F ≈ 6,6:1 (≥ 4,5:1).

- [ ] **Step 4: Formulario y ayuda en Datos**

En `pageData`, sustituir el formulario `#cfgF` y el párrafo de ayuda de "Criterios del semáforo":

```js
      <form class="form" id="cfgF"><label>Horizonte de alerta (meses)<input type="number" name="hz" min="1" max="6" value="${S.cfg.horizonte}"></label>
        <div class="row"><label>Exceso Belloch (meses de stock)<input type="number" name="exB" min="1" max="12" value="${(S.cfg.exceso || {}).Belloch || 6}"></label><label>Exceso Yunsey (meses de stock)<input type="number" name="exY" min="1" max="12" value="${(S.cfg.exceso || {}).Yunsey || 12}"></label></div>
        <div><button class="btn ghost">Guardar criterios</button></div></form>
      <p class="muted small">Rotura: stock proyectado &lt; 0 en el horizonte. Bajo mínimo: &lt; stock mínimo. A revisar: depende de propuestas sin fijar, OF atrasada, rotura antes de la entrada de este mes, sin stock ni entradas, o entradas sin demanda. Exceso (contra stock): el stock de hoy supera la demanda de los próximos meses indicados. Sin demanda: nada previsto en 12 meses.</p></section>
```

Y el envío:

```js
  $('#cfgF').onsubmit = async (ev) => { ev.preventDefault(); const f = ev.target; try { S.cfg = await api('/api/config', { method: 'PUT', body: { horizonte: parseInt(f.hz.value, 10), exceso: { Belloch: parseInt(f.exB.value, 10), Yunsey: parseInt(f.exY.value, 10) } } }); recompute(); updateChrome(); toast('Criterios guardados'); } catch (e) { toast(e.message); } };
```

- [ ] **Step 5: Comprobar en la app**

Arrancar en local (`arrancar.bat` o `python app/app.py` con el `.env` local), publicar `docs/MM_Supply.xlsx` si no hay carga, y comprobar:
- Inicio y Coberturas: la franja de estados muestra "Exceso" con su color entre Cubierto y Sin demanda; al pulsarla filtra.
- Datos: cambiar Exceso Belloch a 3 → guardar → en Coberturas aumenta el número de Exceso sin recargar. Volver a 6.
- Historial de cargas: la columna Estado muestra la insignia de Exceso en la carga nueva (las antiguas tienen los recuentos guardados al publicarlas: es correcto que no la tengan).
- Tema oscuro (menú de usuario): la insignia se lee bien.

- [ ] **Step 6: Commit**

```bash
git add app/static/app.js app/static/app.css
git commit -m "Exceso en pantalla y meses de exceso en Datos

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Valor en € en Inicio, Coberturas, CSV y Ficha

**Files:**
- Modify: `app/static/app.js` (helpers tras `fmt` ~línea 8; `pageHome` ~291–316; `LIST_GET` ~320; `pageList` ~339–356; `downloadCSV` ~382–388; `pageRef` KPIs ~417–423)

**Interfaces:**
- Consumes: `r.pr`, `r.st`, `e.sem`, `e.ex`, `e.fa` (Task 1).
- Produces: helpers `eur(n)`, `keur(n)`, `valor(r, e)`.

- [ ] **Step 1: Helpers**

Debajo de `const fmt = ...`:

```js
const eur = (n) => fmt(n) + ' €';
const keur = (n) => Math.abs(n) >= 1e6 ? (n / 1e6).toLocaleString('es-ES', { maximumFractionDigits: 1 }) + ' M€' : fmt(n / 1000) + ' k€';
```

Debajo de `const ENT = ...`:

```js
// Valor que importa según el estado (a coste, Precio Mixto): exceso, lo que falta en rotura o el stock.
// null = sin precio (con algo que valorar); 0 = nada que valorar
function valor(r, e) {
  const u = e.sem === 'exceso' ? e.ex : e.sem === 'rojo' ? e.fa : Math.max(r.st, 0);
  return !u ? 0 : r.pr > 0 ? u * r.pr : null;
}
const valorCell = (r, e) => { const v = valor(r, e), t = e.sem === 'exceso' ? 'Exceso' : e.sem === 'rojo' ? 'Falta' : 'Stock';
  return v == null ? '<td class="r"><span class="muted">sin precio</span></td>' : `<td class="r num" title="${t}">${v ? eur(v) : '–'}</td>`; };
```

- [ ] **Step 2: Inicio — tres cifras**

En `pageHome`, tras `const li = ...`:

```js
  const conPr = (xs, u) => xs.filter(x => u(x) > 0 && x.r.pr > 0).reduce((s, x) => s + u(x) * x.r.pr, 0);
  const stk = x => Math.max(x.r.st, 0), exc = cs.filter(x => x.e.sem === 'exceso'), sdm = S.ev.filter(x => x.e.sem === 'gris' && x.r.st > 0);
  const sinPr = S.ev.filter(x => x.r.st > 0 && !(x.r.pr > 0)).length;
  const kpi = (href, v, l) => `<a class="kpi kpi-link" href="${href}"><div class="v">${v}</div><div class="l">${l}</div></a>`;
```

Y en el HTML, entre `${strip(...)}` y `<div class="grid">`:

```js
    <div class="kpis">${kpi('#/coberturas?gp=', keur(conPr(S.ev, stk)), `Valor del stock · contra stock ${keur(conPr(cs, stk))}`)}
      ${kpi('#/coberturas?sem=exceso&sort=val&dir=-1', keur(conPr(exc, x => x.e.ex)), `En exceso · ${fmt(exc.length)} refs`)}
      ${kpi('#/coberturas?gp=&sem=gris&sort=val&dir=-1', keur(conPr(sdm, stk)), `Sin demanda · ${fmt(sdm.length)} refs`)}</div>
    ${sinPr ? `<p class="muted small">${fmt(sinPr)} referencias con stock y sin precio no suman.</p>` : ''}
```

(`.kpis`, `.kpi`, `.kpi-link` ya existen en `app.css` y se usan en Porfolio.)

- [ ] **Step 3: Coberturas — columna Valor ordenable**

En `LIST_GET` añadir: `val: x => { const v = valor(x.r, x.e); return v == null ? -1 : v; },`

En la fila de la tabla (`tb.innerHTML`), insertar `${valorCell(r, e)}` justo después de `${cobCell(e)}`, y cambiar `colspan="11"` a `colspan="12"`.

En la cabecera, después de `${thSort('Cobertura · prudente', 'cob', key, dir, 'r')}` añadir `${thSort('Valor', 'val', key, dir, 'r')}`; y en la lista de columnas que ordenan de mayor a menor la primera vez, `['st', 'd0', 'd3', 'mn', 'val']`.

Ordenación por defecto con filtro de exceso o rotura: sustituir `const key = q.get('sort') || 'sem', dir = parseInt(q.get('dir') || '1', 10);` por:

```js
    const porValor = !q.get('sort') && ['exceso', 'rojo'].includes(q.get('sem'));
    const key = q.get('sort') || (porValor ? 'val' : 'sem'), dir = parseInt(q.get('dir') || (porValor ? '-1' : '1'), 10);
```

- [ ] **Step 4: CSV**

En `downloadCSV`, añadir a `head` tras `'Cobertura prudente meses'`: `'Valor stock €', 'Exceso €', 'Rotura €'`, y en cada línea, en la misma posición (tras la cobertura prudente):

```js
r.pr > 0 ? Math.round(Math.max(r.st, 0) * r.pr) : '', r.pr > 0 && e.ex ? Math.round(e.ex * r.pr) : '', r.pr > 0 && e.sem === 'rojo' && e.fa ? Math.round(e.fa * r.pr) : '',
```

- [ ] **Step 5: Ficha**

En `pageRef`, en `.kpis`, después del KPI "Stock hoy":

```js
        <div class="kpi"><div class="v">${r.st > 0 ? (r.pr > 0 ? eur(r.st * r.pr) : 'sin precio') : '–'}</div><div class="l">Valor del stock${e.sem === 'exceso' ? ` · exceso ${fmt(e.ex)} uds${r.pr > 0 ? ' · ' + eur(e.ex * r.pr) : ''}` : e.sem === 'rojo' && e.fa ? ` · falta ${fmt(e.fa)} uds${r.pr > 0 ? ' · ' + eur(e.fa * r.pr) : ''}` : ''}</div></div>
```

- [ ] **Step 6: Comprobar en la app**

- Inicio: tres cifras; con el MM_Supply del 01/10 el stock total ≈ 2,9 M€ (contra stock ≈ 2,7 M€), exceso del orden de 300 k€, sin demanda ≈ 160 k€; cada una abre Coberturas filtrado y ordenado por valor.
- Coberturas con estado Exceso: ordenado por Valor de mayor a menor; con Rotura, igual con lo que falta; las "sin precio" al final.
- CSV: abre en Excel con las tres columnas nuevas.
- Ficha de una referencia en exceso y de una en rotura: KPI de valor con el detalle.

- [ ] **Step 7: Commit**

```bash
git add app/static/app.js
git commit -m "Valor en € en Inicio, Coberturas, CSV y ficha

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Valor en "Inactivos con stock" (Porfolio)

**Files:**
- Modify: `app/core.py` (`porfolio`, línea `inact = sorted(...)` ~287)
- Modify: `app/static/app.js` (`PF_BLOQUES.inactivos` ~668–672)
- Test: `tests/test_core.py` (bloque Porfolio)

**Interfaces:**
- Consumes: `A[k]["precio"]` (ya lo rellena `parse`; en las pruebas `art()` no lo trae → usar `.get`).
- Produces: cada fila de `pf["inact"]` lleva `pr` (float, 2 decimales); orden por valor (stock × precio) descendente.

Nota: "Sin movimiento" no lleva valor (por definición no tiene stock). El spec se corrige en la Task 6.

- [ ] **Step 1: Prueba que falla**

En `tests/test_core.py`, en el diccionario `A` del bloque Porfolio, añadir una segunda inactiva con stock y precio, y fijar precio a `I1`. Cambiar `art()` para aceptar precio:

```python
def art(n, alta=None, inact=False, estado="Producto terminado", gp="Contra Stock", lote=0, mn=0, fina=None, ext=False, suc="", precio=0.0):
    return dict(name=n, estado=estado, inact=inact, alta=alta, fina=fina, gp=gp, lote=lote, min=mn, ext=ext, suc=suc, precio=precio)
```

En `A`: `"I1": art("Inactiva con stock", inact=True, fina=dt.date(2026, 3, 2), precio=0.5),` y añadir `"I3": art("Inactiva cara", inact=True, precio=10.0),`. En `sig`, `ST={"I1": 120.0, "I2": 0.0, "I3": 50.0}`.

Actualizar las comprobaciones afectadas:
- `check("resumen del porfolio", pf["res"] == dict(maestro=10, activos=7, seguimiento=2, fuera=5), pf["res"])`
- Sustituir la de inactivos por:

```python
check("inactivos con stock, ordenados por valor", [(x["k"], x["st"], x["pr"]) for x in pf["inact"]] == [("I3", 50, 10.0), ("I1", 120, 0.5)], pf["inact"])
check("inactivos con su fecha de baja", next(x for x in pf["inact"] if x["k"] == "I1")["fina"] == "2026-03-02")
```

- [ ] **Step 2: Ejecutar y ver que falla**

Run: `python tests/test_core.py`
Expected: `FALLO` en "inactivos con stock, ordenados por valor" (sin `pr` y orden por stock).

- [ ] **Step 3: Implementar en `core.porfolio`**

```python
    inact = sorted((dict(k=k, n=a["name"], st=round(ST.get(k, 0.0)), pr=round(a.get("precio", 0.0), 2), fina=iso(a["fina"]), **ex(k)) for k, a in pt.items()
                    if a["inact"] and ST.get(k, 0.0) > 0), key=lambda x: (-x["st"] * x["pr"], -x["st"]))
```

- [ ] **Step 4: Ejecutar**

Run: `python tests/test_core.py`
Expected: `Todo correcto`.

- [ ] **Step 5: Columna Valor en el bloque**

En `PF_BLOQUES.inactivos.html`:

```js
    html: (pf) => pfTabla(pf.inact.map(x => `<tr>${pfRef(x.k, x.n)}${pfAbc(x.k)}<td class="r num">${fmt(x.st)}</td><td class="r num">${x.pr == null ? '<span class="muted">—</span>' : x.pr > 0 ? eur(x.st * x.pr) : '<span class="muted">sin precio</span>'}</td><td class="num">${fdate(x.fina)}</td>${pfExt(x)}</tr>`).join(''), [['Referencia'], ['ABC'], ['Stock', 'r'], ['Valor', 'r'], ['Inactivo desde'], ['A extinguir']], 'Ninguno.'),
```

Y en el `n` del bloque, mostrar el total: `n: (pf) => fmt(pf.inact.length) + (pf.inact.some(x => x.pr > 0) ? ' · ' + keur(pf.inact.reduce((s, x) => s + (x.pr > 0 ? x.st * x.pr : 0), 0)) : ''),`

- [ ] **Step 6: Comprobar en la app**

Publicar de nuevo `docs/MM_Supply.xlsx` (la carga vieja no trae `pr` en `inact` y debe mostrar "—" sin errores; comprobarlo antes de republicar) y ver Porfolio → Inactivos con stock: columna Valor, orden por valor, total en el título.

- [ ] **Step 7: Prueba de extremo a extremo y commit**

Run (bash): `DATA_DIR=$(mktemp -d) python tests/test_api.py docs/MM_Supply.xlsx`
Expected: `Todo correcto`.

```bash
git add app/core.py app/static/app.js tests/test_core.py
git commit -m "Porfolio: valor de los inactivos con stock

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Documentación

**Files:**
- Modify: `README.md` (sección "Lógica de cálculo", lista del semáforo; tabla "Qué hace")
- Modify: `docs/superpowers/specs/2026-10-01-valor-y-exceso-design.md` (Porfolio: quitar "Sin movimiento")

- [ ] **Step 1: README**

En la lista del semáforo, entre "Cubierto." y "Sin demanda":

```markdown
  - Exceso (solo contra stock): el stock de hoy supera la demanda de los próximos 6 meses en Belloch o 12 en Yunsey (configurable en Datos). Es provisional hasta el módulo de stock mínimo y lotes, que lo cambiará por el stock máximo.
```

Añadir a "Lógica de cálculo":

```markdown
- **Valor**: a coste, con el `Precio Mixto` del maestro. En Inicio: valor del stock, del exceso (stock − demanda de los meses de exceso) y del stock sin demanda. En Coberturas, la columna Valor enseña el exceso en las referencias en exceso, lo que falta (peor mes del horizonte) en las de rotura y el stock en el resto. Las referencias con stock y sin precio aparecen como "sin precio" y no suman.
```

En la tabla "Qué hace", fila Inicio: añadir "valor del stock, del exceso y sin demanda"; fila Porfolio: "inactivos con stock (con su valor)".

- [ ] **Step 2: Spec**

En el apartado 3, sustituir el punto de Porfolio por:

```markdown
- **Porfolio**: "Inactivos con stock" añade el valor (stock × precio) y se ordena por él. ("Sin movimiento" no: por definición no tiene stock.) Requiere añadir `pr` a esas filas en `core.porfolio`; en cargas antiguas sin ese dato se muestra "—" hasta que se publique una carga nueva.
```

- [ ] **Step 3: Pruebas completas y commit**

Run (bash): `python tests/test_core.py && node tests/test_core_js.js && DATA_DIR=$(mktemp -d) python tests/test_api.py docs/MM_Supply.xlsx`
Expected: `Todo correcto` en las tres.

```bash
git add README.md docs/superpowers/specs/2026-10-01-valor-y-exceso-design.md
git commit -m "README: exceso y valor en €

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
