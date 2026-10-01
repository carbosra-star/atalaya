# Desviación de previsiones · diseño

Fecha: 01/10/2026 · Estado: aprobado en conversación, pendiente de revisar por escrito

## Objetivo

Preparar la **revisión trimestral de la previsión con comercial**: ver por marca
dónde y cuánto falla la previsión, si las revisiones trimestrales mejoran, y llevar
a la reunión una lista corta de referencias con una **corrección propuesta**
(por ritmo de venta y por sesgo histórico) que comercial acepta o cambia. Lo
acordado queda registrado por versión y se exporta para controlling.

Enfoque: macro y orientado a decidir. La lista enseña solo lo que tiene
corrección propuesta o hay que revisar, ordenado por efecto en €.

Con el MM_Supply del 01/10/2026 (510 refs contra stock comparables): la nueva
previsión de 12 meses está dentro de ±10 % de la venta de 12 meses en 273 refs y
por encima de +25 % en 54; el sesgo histórico (previsto ÷ vendido) supera +25 %
en 159. Por marca: Nelly +5 %, Yunsey +13 %, DRN +12 %, IMAQE −15 %.

Criterio de éxito: antes de la reunión, el planificador abre una marca, ve su
desviación y la lista de referencias a corregir con su efecto en €; en la reunión
se acepta o cambia cada propuesta; al terminar se descarga el CSV con lo acordado.

## Decisiones

| Tema | Decisión |
|---|---|
| Uso principal | Revisión con comercial antes de cada iteración |
| Agrupación | Marca (`ymarca` del maestro) |
| Resultado | Corrección propuesta por referencia; se acepta, se cambia o se mantiene la de comercial |
| Métodos | Ritmo de venta y sesgo histórico, lado a lado |
| Propuesta | La más prudente: mismo sentido → la menor; sentidos contrarios → "revisar"; < 10 % → sin corrección |
| Forma de la corrección | Un % sobre los 12 meses de comercial (se respeta su reparto mensual) |
| Ligada a | La versión de previsión vigente (hoy 2026Q4) |
| Efecto en el resto de la app | Ninguno todavía: Coberturas y Stock mínimo siguen con la previsión de comercial |

## 1. Cálculo por referencia (`app/desviacion.py`, función `filas`)

Pura y sin gemela en JS, como `parametros.py`. Ámbito: `gp == "Contra Stock"` y
`abc` en A–D. Entradas por referencia (ya en el dataset): `pv` (12 meses de
previsión operativa desde el mes en curso), `vt` y `hp` (12 meses cerrados), `fc` y
`fo` (factor de sesgo y su origen), `abcx` (`"venta"` = 12 meses de venta), `ext`,
`mc`, `md`, `abc`, `pr`.

- `p12` = Σ `pv`; `v12` = Σ `vt`.
- **Ritmo** `cr` (corrección por ritmo de venta) = `v12 / p12 − 1`, solo si no está
  a extinguir, `abcx == "venta"`, `p12 > 0` y `v12 > 0`; si no, `None`.
- **Sesgo** `cs` = `fc − 1`, solo si `fo == "ref"` (sesgo propio, ≥ 6 meses de
  historia); si no, `None`. `fc` ya está limitado a 0,5–1,5.
- **Propuesta** `cp`:
  - ninguna disponible → `None`, `tipo = "sin_dato"`;
  - una sola → esa;
  - las dos con el mismo signo → la de menor valor absoluto;
  - si las dos existen y una está por debajo del 10 % → `0`, `tipo = "sin"` (lo prudente es no corregir; corregido tras la revisión de datos reales);
  - signos contrarios, las dos por encima del 10 % → `None`, `tipo = "revisar"`;
  - limitada a [−50 %, +50 %] (decisión de diseño: prudencia; más allá, se
    decide a mano);
  - |`cp`| < 10 % → `cp = 0`, `tipo = "sin"` (sin corrección);
  - si no, `tipo = "propuesta"`.
  - Orden: elegir → limitar a ±50 % → redondear a porcentaje entero (−0,234 →
    −0,23, fracción con 2 decimales) → umbral del 10 %.
- **Estado**: `acordado` si hay acuerdo vigente para la versión; si no, el `tipo`.
- **Corrección aplicada** `ca` = la del acuerdo si lo hay; si no, `cp` (o 0).
- **Previsión corregida** `pvc12` = `round(pv[m] × (1 + ca))` para los 12 meses,
  nunca negativa; **efecto** `eu` = Σ `pvc12` − `p12` (uds) y `ee` = `eu × pr` (€).

`resumen_marcas(filas, refs)`: por marca (y total), con todas las referencias del
ámbito: nº refs, `p12`, `v12`, desviación `p12/v12 − 1`, **sesgo histórico**
Σ`hp` ÷ Σ`vt` (meses con `hp > 0`) − 1, **error medio** Σ|`vt` − `hp`| ÷ Σ`vt`
(meses con `hp > 0`), nº con propuesta, nº a revisar, nº acordadas y efecto en uds
y € (con `ca`). Orden por `v12` descendente.

## 2. Acierto por versión (`core.parse`)

Para ver si las revisiones mejoran, `parse` guarda en `meta.vers` el error de cada
versión trimestral contra la venta real:

- Para cada versión `AAAAQn` y cada referencia contra stock con ABC A–D que tenga
  filas en esa versión: meses **cerrados** que la versión cubre y que empiezan en o
  después del inicio de su trimestre (la misma regla que `vigentes`: una versión no
  cuenta para meses anteriores a su trimestre).
- La venta de esos meses sale de MM_Vtas (toda la hoja, no solo los 12 últimos
  meses).
- Se acumula por (versión, marca): `e` = Σ|venta − previsión|, `s` = Σ venta,
  `p` = Σ previsión, `n` = nº referencias, `m` = nº de meses distintos.
- En pantalla: error = `e / s`, sesgo = `p / s − 1`.

Las cargas publicadas antes de este cambio no traen `meta.vers`: la tabla dice
"Vuelve a cargar el MM_Supply para verlo".

## 3. Datos (`app.py`, SQLite)

```sql
CREATE TABLE IF NOT EXISTS prev_dec(
  id INTEGER PRIMARY KEY, ref TEXT NOT NULL, md TEXT NOT NULL, version TEXT NOT NULL,
  pct REAL NOT NULL, src TEXT NOT NULL CHECK(src IN ('propuesta','manual','mantener')),
  motivo TEXT NOT NULL DEFAULT '', user_id INTEGER NOT NULL, created TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS prev_dec_ref ON prev_dec(ref, version, id);
```

El acuerdo vigente de una referencia es la última fila con la **versión de la carga
vigente** (`meta.version`). Las de versiones anteriores son historial. No se borran.

## 4. API

- `GET /api/desviacion` (todos): `{version, rows, marcas, vers}` o `{"empty": true}`.
  `?ref=k` filtra `rows`.
- `POST /api/desviacion/acuerdos` (planificador y admin):
  `{items: [{ref, src, pct?}], motivo}`. `src`: `propuesta` (toma `cp`; error si es
  `None`), `mantener` (0), `manual` (`pct` en %, número entre −90 y 300, motivo
  obligatorio). Valida que la referencia está en el ámbito. Hasta 1.000 items.
- `GET /api/desviacion/<ref>/historial`: acuerdos de todas las versiones, con
  usuario.
- `GET /api/desviacion/acuerdos.csv`: acuerdos vigentes de la versión actual.
  `Referencia;Mandante;Marca;Versión;Corrección %;Motivo;mm/aa × 12` (previsión
  corregida de los 12 meses desde el mes en curso). Latin-1, `;`, CRLF, % con coma
  decimal, motivo sin `;` ni saltos de línea. Caracteres no representables en
  Latin-1 se sustituyen por `?`.

## 5. Pantallas (`app.js`)

**Sección "Desviación de previsiones"** (sustituye a "pronto"):

1. **Tabla por marca** (la de §1). Pulsar una marca filtra lo de abajo
   (`?mc=`); una fila "Total" arriba.
2. **Acierto por versión** de la marca elegida (o total): versión · meses ·
   referencias · error · sesgo, ordenada por versión.
3. **Lista para la reunión**: por defecto estados `propuesta` + `revisar`
   (filtros: estado, mandante, ABC), ordenada por |`ee`|. Columnas: referencia · ABC
   · previsión 12 m · venta 12 m · ritmo % · sesgo % · propuesta % · previsión
   corregida 12 m · efecto € · estado. Por fila (planificador/admin): "Aceptar",
   campo % + "Otro %", "Mantener". Campo de motivo común (obligatorio con "Otro %").
   "Aceptar las N propuestas" de lo filtrado (solo estado `propuesta`). Botón
   "Descargar acuerdos (CSV)".
4. **Ficha**: bloque "Previsión" con ritmo, sesgo, propuesta, acuerdo vigente e
   historial de acuerdos.

## 6. Pruebas

- `tests/test_desviacion.py`: ritmo y sesgo; elegibilidad (a extinguir, ABC
  provisional, sin venta, sesgo de grupo); mismo signo → la menor; signo contrario →
  revisar; límite ±50 %; < 10 % → sin corrección; previsión corregida y efecto en
  uds/€; acuerdo vigente; resumen por marca (sesgo y error históricos).
- `tests/test_core.py`: `meta.vers` con datos inventados (meses anteriores al
  trimestre excluidos, solo referencias con filas en la versión).
- `tests/test_api.py`: acuerdos (fuentes, manual sin motivo, lector, fuera de
  ámbito, rango), acuerdo ligado a la versión, historial, CSV (cabecera, mm/aa,
  coma decimal) y `meta.vers` con el MM_Supply real.

## Fuera de alcance

- Usar lo acordado en Coberturas o Stock mínimo (llegará con el consolidador o
  con la siguiente carga de controlling).
- Generar el fichero de carga de previsiones de ABAS (M-03…M12): consolidador.
- Previsión de distribuidores y canal internacional.
- Responsable comercial por marca.
