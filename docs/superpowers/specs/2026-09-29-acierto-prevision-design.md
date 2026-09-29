# Acierto de la previsión en coberturas · diseño

Fecha: 29/09/2026 · Estado: aprobado en conversación

## Objetivo

Hoy la app toma la previsión de controlling como verdad. Con los datos del
29/09/2026, en las referencias contra stock se vende de media entre el 75 % y el
93 % de lo previsto según la clase ABC, y el error mes a mes va del 33 % (A) al
95 % (D). Se quiere:

1. **Corregir el sesgo**: poder proyectar con una previsión corregida que se
   parezca a lo que de verdad se vende (afecta a proyección, cobertura y semáforo).
2. **Tener en cuenta el error**: una *cobertura prudente* que descuente la
   incertidumbre de cada referencia (informativa, no cambia el semáforo).
3. **Ver el acierto** de cada referencia en su ficha.

Queda fuera el módulo completo de "Desviación de previsiones" (análisis por
marca, mandante y versión) y el cálculo de stock de seguridad, que irán en sus
propias secciones. Los parámetros de este diseño son provisionales y se
ajustarán entonces.

Criterio de éxito: el planificador ve para cada referencia cuánto se ha
desviado la previsión, y con la previsión corregida el semáforo deja de alarmar
por referencias cuya previsión se pasa sistemáticamente.

## Decisiones

| Tema | Decisión |
|---|---|
| Activación | Selector "Previsión: tal cual / corregida", por defecto *tal cual* |
| Factor de sesgo | Por referencia, venta 12 m ÷ previsión vigente 12 m, con ≥ 6 meses de historia; si no, el de su grupo mandante × ABC; siempre limitado a 0,5–1,5 |
| Cobertura prudente | stock ÷ (demanda/mes corregida × (1 + error)), error con tope del 100 % |
| Dónde se calcula | En el servidor al leer el MM_Supply; el navegador solo elige |

## 1. Datos y cálculo (`core.py`, en `parse`)

**Ventana**: los 12 últimos meses cerrados (índices −12 … −1 respecto al mes en
curso). La venta sale de MM_Vtas (ya se lee en `vt`).

**Previsión vigente de un mes pasado m**: de las versiones `AAAAQn` que tienen
filas para m y cuyo trimestre empieza en o antes de m (inicio de `AAAAQn` =
mes 3·(n−1)+1 de AAAA), la más reciente. Si ninguna cumple, ese mes no tiene
previsión vigente. Así nunca se usa una versión para meses anteriores a su
trimestre (2026Q2 cubre enero, pero enero no se toma de 2026Q2).

En `meta.hist_src` se guarda la versión vigente de cada mes de la ventana (es
la misma para todas las referencias). **Por referencia** se añaden al dataset:

- `hp`: previsión vigente de los 12 meses (redondeada).
- `hm`: meses con historia = meses con `hp > 0`.
- `fc`: factor de sesgo; `fo`: origen, `"ref"` o `"grupo"` (o `"sin"` si es 1 por falta de datos).
- `er`: error medio = Σ|venta − previsión| ÷ Σ venta en la ventana, sobre la
  previsión tal cual. `null` si no hay dato (Σ venta = 0 y sin grupo).
- `pvc`, `pv0rc`: previsión corregida de los 12 meses (`pv × fc`) y resto del
  mes en curso corregido (la regla de días naturales aplicada a `pv[0] × fc`).

**Reglas del factor**

- Con `hm ≥ 6` y Σ previsión > 0: `fc = Σ venta ÷ Σ previsión`, sumando la venta solo de los meses con previsión (corregido en la revisión final: comparar mes con mes), `fo = "ref"`.
- Si no: factor del grupo (mandante, ABC) = Σ venta ÷ Σ previsión de las
  referencias del grupo con `hm ≥ 6`; `fo = "grupo"`.
- Si el grupo no tiene ninguna referencia con `hm ≥ 6`: `fc = 1`, `fo = "sin"`.
- Siempre `fc = min(1,5, max(0,5, fc))`.

**Reglas del error**: con `hm ≥ 6` y Σ venta > 0, el propio; si no, el del
grupo calculado igual sobre sus referencias con `hm ≥ 6` (Σ|v−p| ÷ Σ v); si
tampoco, `null`. En la ficha se muestra sin tope.

Los meses con venta y sin previsión cuentan en el error pero no en `hm`.

## 2. Evaluación (`core.py` y `static/core.js`, gemelos)

- `project(r, esc, pv)` con `pv` en `"T"` (tal cual: `pv`, `pv0r`) o `"C"`
  (corregida: `pvc`, `pv0rc`). Si la carga no trae `pvc` (cargas antiguas), `"C"`
  se comporta como `"T"`.
- `evaluate` recibe también la previsión; semáforo, proyección, demanda/mes y
  cobertura la usan. Los pedidos siguen mandando cuando son mayores.
- **Cobertura prudente** (solo JS, informativa): demanda/mes con previsión
  corregida (media de los meses 1–3) × (1 + min(`er`, 1)); `stock ÷ eso`. Sin
  `er`, se usa `er = 0`. Mismo tratamiento que la cobertura normal para 0 y
  sin demanda.
- `/api/dataset` devuelve la carga anterior evaluada en las 6 combinaciones
  (`OF|OFPF|ALL` × `T|C`), claves `"ALL"`, `"ALL_C"`, etc.

## 3. Pantallas (`static/app.js`)

- Selector "Previsión" (Tal cual / Corregida) junto al de entradas, en todas
  las pantallas que ya lo tienen; se guarda en `localStorage` (`prev`).
- Coberturas: columna "Cob. prudente" ordenable. CSV: columnas "Factor sesgo",
  "Error previsión", "Cobertura prudente".
- Ficha: indicador "Cobertura prudente (previsión corregida)" y sección
  "Acierto de la previsión": frase resumen ("En 12 meses se vendió el 93 % de
  lo previsto; error medio mes a mes 33 %; factor 0,93 (propio)" o "(de su
  grupo Belloch · B)") y tabla de 12 meses con previsión vigente, venta,
  desviación % y versión.
- Textos que dicen qué se está viendo ("con OF y todas las propuestas") añaden
  "y previsión corregida" cuando toca.

## 4. Pruebas

- `tests/test_core.py` (nuevo, sin Excel): datos inventados para previsión
  vigente, mínimo de 6 meses, límites 0,5–1,5, respaldo por grupo, grupo sin
  historia y cálculo del error.
- `tests/test_api.py`: paridad Python/JS en las 6 combinaciones × 3 horizontes;
  la carga anterior trae las 6 claves.
