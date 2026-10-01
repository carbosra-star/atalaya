# Stock mínimo, lote y stock máximo · diseño

Fecha: 01/10/2026 · Estado: aprobado en conversación, pendiente de revisar por escrito

## Objetivo

Segunda de tres piezas (1 € y exceso → **2 parámetros de planificación** → 3
capacidad). Hoy el stock mínimo y el lote de ABAS se fijan a mano y se revisan en
un Excel (`Datos_Manual`). Se quiere que la app:

1. **Calcule** para cada PT contra stock un lote y un stock de seguridad con dos
   métodos (el del Excel y el estadístico del CLAUDE.md) frente al valor del ERP.
2. **Proponga** uno por defecto y deje **decidir** solo las excepciones, con
   historial (quién, cuándo, de qué a qué y por qué).
3. **Genere el fichero** de cambios para cargar en ABAS y detecte sola cuándo
   están aplicados.
4. Vigile la restricción de **no subir la inversión total** con el valor en € por
   mandante y clase.
5. Dé el **stock máximo** (stock de seguridad + lote), que sustituye al criterio
   provisional de exceso de la pieza 1.

Enfoque: macro y orientado a decidir. La lista enseña por defecto solo lo que
cambia, ordenado por impacto en €.

Con el MM_Supply del 01/10/2026 (832 refs contra stock, aproximado): SS del ERP
684 k€; método Excel 1.275 k€ (+590 k€); estadístico 658 k€ (−26 k€), con 182
irregulares y 84 sin historia que se quedan con el ERP.

Criterio de éxito: en una sesión se revisan las excepciones de una clase, se
aceptan en bloque las propuestas razonables, se descarga el fichero para ABAS y,
en la carga siguiente, la app las marca como aplicadas; el total en € de lo
decidido no supera al de hoy.

## Decisiones

| Tema | Decisión |
|---|---|
| Métodos | Excel (lote × % SS) y estadístico, lado a lado frente al ERP |
| Propuesta por defecto | Estadístico si hay cifra; si no, ERP y "decidir a mano" |
| Niveles de servicio | A 95 %, B 90 %, C 85 %, D 85 %, por mandante, editables |
| Plazo | 15 días laborables (3 semanas) + plazo extra de material por referencia (editable) |
| Yunsey | Solo sube hasta la migración (no se proponen bajadas) |
| Resultado | Decisión con historial + CSV para ABAS; aplicado se detecta en la carga siguiente |
| Exceso | Stock > stock máximo (decidido o ERP); sin lote, criterio de meses de la pieza 1 |
| Ámbito | Solo contra stock con ABC A–D. Bajo pedido (NA) fuera |

## 1. Cálculo (`core.py`, función nueva `parametros`)

Se calcula en el servidor, sin gemela en JS (la evaluación del semáforo solo
necesita el stock máximo, ver §5).

`parametros(refs, cfg, decisiones, extra) -> list[dict]`, una fila por referencia
contra stock con `abc` en A–D. Entradas por referencia (ya en el dataset): `md`,
`abc`, `pv` (12 meses), `vt` y `hp` (12 meses cerrados), `mn`, `lt`, `pr`, `st`.

**Lote calculado** `lc`:
- `anual` = Σ `pv` (12 meses); `f` = fabricaciones al año de su mandante y clase
  (`cfg.abc.freq`).
- `lc = anual / f`, redondeado a miles si ≥ 10.000, a centenas por debajo, con
  mínimo 100 si `anual > 0`; 0 si `anual == 0`.

**Stock de seguridad método Excel** `sx_xl = round100(lc × ss% de la clase)`
(`cfg.abc.ss`, 75/75/50/0).

**Stock de seguridad estadístico** `sx_st`:
- Meses válidos = meses cerrados con `hp > 0`. Si hay menos de 6, o la venta media
  de esos meses ≤ 0 → `sx_st = None`, `tipo = "sin_hist"`.
- `etr` = desviación típica poblacional de (venta − previsión) en los meses
  válidos ÷ venta media de esos meses.
- `sesgo` = Σ previsión ÷ Σ venta − 1 en los meses válidos (positivo =
  sobreprevisión).
- Si `etr > 1` → `sx_st = None`, `tipo = "irregular"`.
- Si no: `pq` = media de `pv[1..3]`; `plazo` = (15 + días extra) / 21 meses;
  `z` = inversa normal del nivel de servicio (`cfg.ns[md][clase]`);
  `v = z × etr × pq × √plazo`.
- Reglas, en este orden:
  1. sesgo > +20 % → `v = min(v, mn)` (no sube; marca "corregir previsión").
  2. sesgo < −20 % → solo marca "corregir previsión".
  3. si `mn > 0`: `v` limitado a [0,5·mn, 2·mn].
  4. Yunsey: `v = max(v, mn)`.
  5. `sx_st = round100(v)`; `tipo = "ok"`.

**Sin propuesta automática** (añadido en la revisión final): las referencias **a extinguir** (`tipo = "extinguir"`) y las que no tienen previsión en 12 meses o en el próximo trimestre (`tipo = "sin_prev"`, p. ej. temporada) no reciben estadístico ni lote calculado como propuesta: darían lote 0 o la mitad del SS por el límite ×0,5 y falsearían el total en €. Su propuesta es el ERP y quedan para decidir a mano.

**Propuesta**:
- `ss_p` = `sx_st` si `tipo == "ok"`; si no, `mn` (y `tipo` queda marcado para
  decidir a mano).
- `lt_p` = `lc` en los dos mandantes (el lote puede bajar también en Yunsey: la
  restricción de "solo sube" es sobre el stock mínimo).
- **Umbral de ruido**: si |`ss_p` − `mn`| < máx(10 % de `mn`, 100) se propone `mn`;
  igual para el lote frente a `lt`. Así la lista no se llena de cambios pequeños.

**Δ €** = ((`ss` − `mn`) + (`lote` − `lt`) / 2) × `pr`, con `ss`/`lote` = lo
decidido si hay decisión, si no la propuesta. Es la variación del stock medio.

**Estado** de la fila:
- `aplicado`: la decisión vigente se marcó como aplicada (§2) y el ERP sigue con
  esos valores.
- `decidido`: hay decisión que todavía no se ha visto aplicada en ninguna carga.
- Si una decisión ya aplicada deja de coincidir con el ERP (alguien lo cambió en
  ABAS), la decisión se ignora: la fila se trata como sin decisión (`cambio`,
  `igual` o `decidir`) y no vuelve al fichero de ABAS.
- `decidir`: sin decisión y `tipo` ≠ `ok`.
- `cambio`: sin decisión y propuesta ≠ ERP.
- `igual`: sin decisión y propuesta = ERP.

**Stock máximo** `smax` = ss + lote de la decisión vigente (si no se ignora); si no hay, `mn + lt`
del ERP; si `lt == 0`, `None`.

`round100(x)` = múltiplo de 100 más cercano, nunca negativo.

## 2. Datos (`app.py`, SQLite)

Tablas nuevas:

```sql
CREATE TABLE IF NOT EXISTS param_dec (
  id INTEGER PRIMARY KEY, ref TEXT NOT NULL, md TEXT NOT NULL,
  ss INTEGER NOT NULL, lote INTEGER NOT NULL,
  src_ss TEXT NOT NULL CHECK(src_ss IN ('erp','excel','estadistico','manual')),
  src_lote TEXT NOT NULL CHECK(src_lote IN ('erp','calculado','manual')),
  ss_antes INTEGER, lote_antes INTEGER,           -- ERP en el momento de decidir
  motivo TEXT NOT NULL DEFAULT '', user_id INTEGER NOT NULL, created TEXT NOT NULL,
  aplicado TEXT);                                 -- fecha de datos de la carga en la que se vio aplicada
CREATE INDEX IF NOT EXISTS param_dec_ref ON param_dec(ref, id);
CREATE TABLE IF NOT EXISTS param_extra (
  ref TEXT PRIMARY KEY, dias INTEGER NOT NULL, motivo TEXT NOT NULL DEFAULT '',
  user_id INTEGER NOT NULL, created TEXT NOT NULL);
```

La decisión vigente de una referencia es la última fila de `param_dec`; las demás
son su historial. Nunca se borran. Al publicar una carga (`/api/upload` sin
`dry`), las decisiones vigentes sin `aplicado` cuyo `ss`/`lote` coinciden con el
`mn`/`lt` de la carga nueva se marcan con su fecha de datos.

Configuración nueva en `config` (clave `ns`): `{"Belloch": [95, 90, 85, 85],
"Yunsey": [95, 90, 85, 85]}`, validada como cuatro números entre 50 y 99,9.

## 3. API

- `GET /api/parametros` (todos los roles): `{rows, resumen}` calculado con la
  carga vigente, la configuración, las decisiones y los plazos extra. `resumen`:
  por mandante × clase, € de SS y de stock medio en ERP / propuesta / decidido
  (decidido = decisión si la hay, si no ERP), y recuento por estado.
- `POST /api/parametros/decisiones` (planificador y admin):
  `{items: [{ref, ss: {src, v?}, lote: {src, v?}}], motivo}`. `v` solo para
  `manual`; el valor de las demás fuentes lo pone el servidor desde el cálculo.
  `motivo` obligatorio si algún item es manual. Validación: referencia en la
  carga vigente y en el ámbito; enteros ≥ 0; hasta 1.000 items por llamada.
- `GET /api/parametros/<ref>/historial`: filas de `param_dec` de la referencia,
  con el nombre del usuario.
- `PUT /api/parametros/<ref>/plazo` (planificador y admin): `{dias, motivo}`,
  días laborables extra 0–250.
- `GET /api/parametros/abas.csv`: decisiones en estado `decidido`, CSV
  `Referencia;Mandante;Stock mínimo;Lote`, Latin-1, `;`, códigos como texto, sin
  BOM. Nombre `parametros_abas_AAAAMMDD.csv`.
- `PUT /api/config` acepta `ns`.

## 4. Pantallas (`app.js`)

**Sección "Stock mínimo y lotes"** (sustituye a la página "pronto"):

1. **Resumen**: tabla mandante × clase con € de stock de seguridad y stock medio
   en ERP / propuesta / decidido, y total. Debajo, cuatro contadores enlazados:
   por decidir a mano · con cambio propuesto · decididos pendientes de ABAS ·
   aplicados. Botón "Descargar cambios para ABAS (N)".
2. **Lista**: por defecto estados `decidir` + `cambio`, ordenada por |Δ €|
   descendente. Filtros: mandante, ABC, línea, estado. Columnas: referencia · ABC
   · previsión/mes · error % · SS ERP | Excel | Estadístico | **propuesta** · lote
   ERP | **calculado** · Δ € · estado (con marca "irregular", "sin historia" o
   "corregir previsión" si aplica).
   - En cada fila: selector de fuente para SS (ERP / Excel / Estadístico /
     Manual) y para lote (ERP / Calculado / Manual), con campo numérico si es
     manual, y botón "Decidir". Si hay manual, pide el motivo.
   - "Aceptar las N propuestas con cambio" de lo filtrado (solo estado `cambio`: las de decidir a mano no se resuelven en bloque), con un motivo común (opcional).
   - Lector: la misma lista sin controles.
3. **Ficha de referencia**: bloque "Parámetros" con ERP, Excel, estadístico,
   propuesta, decisión vigente, plazo extra (editable) e historial.
4. **Datos**: niveles de servicio por mandante y clase junto a la frecuencia y
   el % SS.

## 5. Exceso con el stock máximo (`core.py`, `core.js`, `app.py`)

- `/api/dataset` añade a cada referencia `sx` = `smax` (§1) o `null`.
- `evaluate` (las dos gemelas): si `r.sx` > 0, exceso cuando `st > sx`, con
  `ex = st − sx`; si `r.sx` es null o no existe, el criterio de meses de la
  pieza 1. Mismas condiciones de antes (solo contra stock, solo si quedaría
  verde). `why = "Por encima del stock máximo"`.
- La evaluación del servidor (resumen de carga y carga anterior) usa el `sx` de
  las decisiones vigentes.
- Datos y README: la regla nueva.

## 6. Pruebas

- `tests/test_core.py`: `parametros` con casos inventados — lote y redondeo
  (≥ 10.000 a miles, por debajo a centenas, mínimo 100), SS Excel, estadístico
  con z, error y plazo; irregular (> 100 %); sin historia (< 6 meses); sesgo
  > +20 % no sube; límites ×0,5–×2; Yunsey no baja; umbral de ruido; estados
  aplicado/decidido/decidir/cambio/igual; smax con y sin lote; plazo extra.
- `tests/test_core.py` y `tests/test_core_js.js`: exceso por stock máximo y
  vuelta al criterio de meses sin `sx`.
- `tests/test_api.py`: decisiones (fuentes, manual sin motivo rechazado, rol
  lector rechazado, ref fuera de ámbito rechazada), historial, plazo, CSV (formato
  y que solo trae `decidido`), aplicado al publicar una carga cuyo ERP coincide (se decide
  justo el valor del ERP actual y se republica) y decisión ignorada si el ERP
  cambia después, `ns` en config,
  paridad core.py/core.js con `sx`.

## Fuera de alcance

- Stock mínimo de materiales críticos para bajo pedido.
- Corregir la previsión (solo se marca).
- Separar stock bloqueado o en cuarentena.
- Capacidad por línea (pieza 3).
