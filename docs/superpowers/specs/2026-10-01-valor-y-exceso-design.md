# Valor en € y exceso de stock · diseño

Fecha: 01/10/2026 · Estado: aprobado en conversación, pendiente de revisar por escrito

## Objetivo

Primera de tres piezas acordadas (1 € y exceso → 2 stock mínimo, lote y máximo →
3 capacidad y saturación). La app hoy solo mira la falta de stock y solo en
unidades. Se quiere:

1. **Ver el exceso**: referencias contra stock con más stock del que van a
   consumir en un plazo razonable, como un estado más del semáforo.
2. **Ver el dinero**: el valor del stock, del exceso y del stock sin demanda, para
   priorizar por impacto y vigilar la restricción de no subir la inversión total.

Criterio de enfoque (vale para todo): mirada macro y orientada a decidir. Pocas
cifras, listas ordenadas por €; nada de € mes a mes ni desgloses "por si acaso".

Criterio de éxito: en Inicio se ve cuánto dinero hay en stock, en exceso y sin
demanda; en Coberturas se puede filtrar el exceso y ordenarlo por € para decidir
por dónde empezar.

Con el MM_Supply del 01/10/2026 (contra stock: 832 refs, ≈ 2,67 M€): cobertura
> 6 meses son 187 refs y ≈ 356 k€; > 12 meses, 107 refs y ≈ 166 k€; sin demanda
con stock, 104 refs y ≈ 160 k€.

## Decisiones

| Tema | Decisión |
|---|---|
| Criterio de exceso (provisional hasta el módulo 2) | Stock actual > demanda acumulada de los próximos **6 meses (Belloch)** o **12 meses (Yunsey)** |
| Dónde se ve | Nuevo estado del semáforo, **Exceso**, entre Cubierto y Sin demanda |
| A quién aplica | Solo contra stock |
| Precio | `Precio Mixto` del maestro (a coste) |
| Rotura en € | Solo en Coberturas y Ficha (no en Inicio): unidades que faltan en el horizonte × precio |
| Configuración | Meses de exceso por mandante editables en Datos (1–12) |

## 1. Regla del estado Exceso (`core.py` y `core.js`, en `evaluate`)

Se evalúa al final, solo si la referencia ha quedado en **verde** (Cubierto) tras
todas las reglas actuales, incluidas las de amarillo. Rotura, bajo mínimo y "a
revisar" mandan siempre.

- `N` = meses de exceso del mandante de la referencia (`cfg.exceso[md]`, por
  defecto Belloch 6, Yunsey 12).
- `dN` = Σ de la demanda proyectada (`all.dem`) de los meses 0 … N−1. El mes 0 es
  el resto del mes en curso, como en la proyección.
- Si `gp == "Contra Stock"` y `st > dN` → `sem = "exceso"`,
  `why = "Stock para más de N meses"`.
- `ex` = `st − dN` en unidades (0 si no hay exceso). Se devuelve siempre en el
  resultado de `evaluate`.
- `fa` (faltante) = −mín(stock proyectado de los meses 0 … horizonte−1, 0) en
  unidades: lo que falta en el peor mes del horizonte con el escenario de entradas
  elegido. Se calcula para todas las referencias; en pantalla se usa en las que
  están en Rotura.

Como la demanda depende del selector de previsión (tal cual o corregida), el
exceso también: con la corregida puede subir. No depende del escenario de
entradas, porque mide el stock actual.

Las referencias sin demanda en 12 meses siguen en gris ("Sin demanda"), no en
exceso.

Los dos `evaluate` (Python y JS) reciben el parámetro nuevo y deben dar el mismo
estado; lo comprueba la prueba de paridad de `test_api.py`.

## 2. Configuración (`app.py`)

- Clave nueva `exceso` en la tabla `config`: `{"Belloch": 6, "Yunsey": 12}`.
- `PUT /api/config` acepta `exceso`. Validación: enteros de 1 a 12 para los dos
  mandantes (12 es el horizonte de la proyección).
- La evaluación del servidor (resumen de Inicio, CSV, comprobación de la carga)
  usa estos valores. El navegador los recibe con el resto de la configuración.
- En **Datos**, junto a los criterios del semáforo: "Exceso: stock para más de
  [6] meses en Belloch y [12] en Yunsey".

## 3. Valor en € (solo navegador, salvo Porfolio)

`r.pr` (precio) ya viaja en el dataset; no hace falta nueva carga para
Coberturas, Inicio y Ficha.

- **Inicio**, una fila de tres cifras:
  - valor del stock en seguimiento (Σ st × pr, stock > 0), con el de contra stock debajo;
  - valor en exceso (Σ ex × pr de las refs en Exceso), con su nº de referencias;
  - valor sin demanda (Σ st × pr de las refs en gris con stock), con su nº de referencias.

  Cada cifra enlaza a Coberturas filtrado por ese estado.
- **Coberturas**: una columna **Valor** ordenable: exceso × precio si está en
  Exceso; faltante × precio si está en Rotura; stock × precio en el resto. Con
  filtro de estado Exceso o Rotura, la lista sale ordenada por esa columna. El
  CSV añade "Valor stock €", "Exceso €" y "Rotura €".
- **Ficha**: en la cabecera, valor del stock y, si aplica, "Exceso: N uds · X €"
  o "Falta: N uds · X €".
- **Líneas y Reunión semanal**: el estado nuevo aparece en el reparto de colores
  y en los filtros, sin más columnas.
- **Porfolio**: "Inactivos con stock" y "Sin movimiento" añaden el valor (stock ×
  precio) y se ordenan por él. Requiere añadir `pr` a esas filas en
  `core.porfolio` (servidor); en cargas antiguas sin ese dato se muestra "—"
  hasta que se publique una carga nueva.

**Sin precio**: si una referencia tiene stock y precio 0, el valor se muestra
como "sin precio" (no 0 €) y no suma en los totales; en Inicio se indica "N refs
sin precio". Hoy son 4.

Formato: euros sin decimales con separador de miles; en Inicio, en miles
("326 k€").

## 4. Semáforo en pantalla

- `SEM` añade `['exceso', 'Exceso']` entre `verde` y `gris`; `SEMORD` se
  reordena. Color propio (azul), definido como variable en `app.css`, con
  contraste suficiente en la insignia y la barra.
- Textos de ayuda del semáforo (Datos, README) con la regla nueva.

## 5. Pruebas

- `tests/test_core.py`: exceso Belloch (6 m) y Yunsey (12 m), en el límite exacto
  (st == dN no es exceso), faltante `fa` con y sin rotura en el horizonte, bajo pedido nunca exceso, prioridad (una ref con
  rotura o "a revisar" no pasa a exceso), sin demanda sigue en gris, efecto del
  selector de previsión corregida.
- `tests/test_core_js.js`: los mismos casos en la gemela.
- `tests/test_api.py`: validación de `exceso` en `/api/config` (fuera de rango,
  no entero, un mandante ausente) y paridad Python/JS con el MM_Supply real.

## Fuera de alcance

- Rotura en € en Inicio; € mes a mes o por marca/familia (si acaso, vista S&OP futura).
- Exceso basado en stock máximo (mínimo + lote): llegará con el módulo 2, que
  sustituirá este criterio provisional.
- Exceso generado por OF o propuestas futuras (solo se mira el stock de hoy).
- Exceso en bajo pedido.
