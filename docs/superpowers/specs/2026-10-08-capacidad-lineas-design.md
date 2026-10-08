# Capacidad y saturación por línea — diseño

Fecha: 2026-10-08 · Pieza 3 de Atalaya · Aprobado en conversación con el usuario.

## Objetivo

Mirada a medio/largo plazo (12 meses) para decidir turnos e inversiones: qué líneas no llegan, en qué meses
y cuántos turnos harían falta. Sin secuencia semanal ni detalle operativo.
Éxito: de un vistazo se ven las líneas por encima del 100 % y los turnos necesarios.

## Datos

### Parámetros por línea (tabla nueva `linea_cap`)

`linea_cap(codigo TEXT PRIMARY KEY, vmax REAL, oee REAL, turnos REAL, user_id INTEGER NOT NULL, updated TEXT NOT NULL)`

- `codigo` = grupo de máquina de MM_Maq (AER-01, CS1-1, LA3…), igual que `linea_alias` y `linea_area`; no depende de la carga.
- Se editan en «Editar líneas» (planificador y administrador), junto al nombre corto y el área.
- Valores iniciales (sembrados al crear la tabla si está vacía), de la hoja «TD PMP Capacidad Prev» del Excel
  `docs/Seguimiento_Coberturas_2027.xlsx`:

| Código | V.max (uds/h) | OEE | Turnos |
|---|---|---|---|
| AER-01 | 4200 | 0,601 | 1 |
| AER-02 | 2100 | 0,488 | 1 |
| AER-03 | 1900 | 0,45 | 1 |
| CER-01 | 754 | 0,57 | 1 |
| CS1-1 | 1400 | 0,42 | 1 |
| CS1-2 | 1400 | 0,46 | 1 |
| CS1-17 | 3200 | 0,40 | 1 |
| FO2-4 | 60 | 0,70 | 1 |
| CS3-1 | 2000 | 0,35 | 1 |
| CS3-4 | 2000 | 0,275 | 1 |
| CS3-6 | 2500 | 0,40 | 1 |
| CS3-11 | 3000 | 0,73 | 1 |
| LA1 | 1800 | 0,57 | 1 |
| LA2 | 1800 | 0,47 | 1 |
| LA3 | 1600 | 0,51 | 1 |
| LA4 | 1300 | 0,51 | 1 |
| LA5 | 1300 | 0,67 | 1 |
| CS1-13 | 500 | 0,70 | 1 |
| CS1-14 | 500 | 0,70 | 1 |

(CS1-13 y CS1-14 son procesos manuales sin turnos en el Excel: se siembran con 1 turno.)

### Parámetros generales (`config`, clave `capacidad`; los edita el administrador en Datos)

- `horas_turno` = 7,75; `holgura` = 0,20.
- `dias`: días laborables por mes `{"2026-10": 21, …}`. Iniciales del Excel: 2026 = 21,20,18,19,20,20,23,15,21,21,20,16 (ene–dic);
  2027 = 18,20,17,21,21,21,22,16,22,20,21,16. Mes sin dato → días de lunes a viernes del mes.
- Validación: horas 1–24, holgura 0–0,9, días 0–31 enteros.

## Cálculo (en `app/static/core.js`, `Cob.carga`; sin gemela en Python, como la cobertura)

Por referencia, contra stock **y** bajo pedido, mes a mes `m = 0..11`:

- `dem[m]` = la demanda de `project` (respeta el selector de previsión tal cual / corregida).
- `of[m]` = OF del mes (tipo `OF`; las de fecha pasada ya caen en el mes 0). Los pedidos de compra (`PC`) reducen la
  necesidad pero **no** cargan la línea. Las propuestas no se usan.
- `ss` = stock mínimo decidido en Stock mínimo y lotes o, si no hay, el del ERP (`r.ss`, que el servidor añade junto a `sx`);
  bajo pedido = 0; a extinguir = 0 (solo consumen su stock).
- Neteo: `disp = s + of[m] + pc[m]`; `nec[m] = max(0, dem[m] + ss − disp)`; `s = disp + nec[m] − dem[m]`; con `s` inicial = stock.
- Carga de la referencia en el mes = `of[m] + nec[m]`.

Por línea: carga = suma de sus referencias. Capacidad del mes:
`cap1[m] = vmax × oee × horas_turno × dias[m] × (1 − holgura)` (un turno); `cap[m] = cap1[m] × turnos`.

- Saturación = carga ÷ cap. Turnos necesarios = `ceil(carga ÷ cap1)` (0 si no hay carga).
- Colores: verde < 85 %, ámbar 85–100 %, rojo > 100 %.
- Área: suma de cargas ÷ suma de capacidades de sus líneas con parámetros.
- Línea sin parámetros y «Sin línea asignada»: carga en uds, saturación «—».
- Mes en curso: capacidad completa del mes (simplificación; la carga del mes 0 incluye lo que queda del mes y los atrasados).

## Pantallas

1. **Líneas** (tabla existente): columnas nuevas Saturación de los 3 próximos meses, Saturación media 12 m,
   Turnos actuales y Turnos necesarios (máximo de los 3 meses). Orden por saturación de 3 meses descendente.
   «Editar líneas» gana V.max, OEE (en %) y Turnos.
2. **Página de línea**: bloque «Capacidad» con filas Capacidad, Carga, Saturación y Turnos necesarios a 12 meses,
   y la nota «Carga: contra stock y bajo pedido; OF + necesidad neta para mantener el stock mínimo».
   La tabla actual de demanda y entradas no cambia.
3. **Capacidad** (página nueva en el menú, `#/capacidad`): matriz línea × 12 meses coloreada por saturación,
   agrupada por área (fila de área), columna final con la media de 12 meses; detalle al pasar el ratón
   (carga, capacidad, turnos necesarios); clic en la línea → su página; CSV.
4. **Datos**: bloque «Capacidad» con horas por turno, holgura y días laborables de los 12 meses del horizonte.

## API

- `GET /api/lineas` añade `vmax`, `oee`, `turnos` a cada línea; `PUT /api/lineas` acepta `cap: {codigo: {vmax, oee, turnos}}`
  (vacío = borrar; números > 0, OEE 0–1, turnos 0–3).
- La configuración `capacidad` viaja con el resto de `config` y se guarda por el endpoint de configuración existente.
- El dataset que recibe el navegador incluye `cap` (parámetros de línea) y `r.ss` por referencia.

## Pruebas

- `tests/test_core_js.js`: `Cob.carga` con stock por encima del mínimo (sin necesidad), OF que cubre, bajo pedido (ss 0),
  pedido de compra que reduce necesidad sin cargar.
- `tests/test_api.py` (siempre con DATA_DIR temporal): siembra de `linea_cap`, PUT de parámetros y validación,
  configuración `capacidad`.
- Comprobación manual: capacidad de AER-01 en un mes del Excel cuadra con su hoja (281.700,72 en ene-27 con 18 días, 1 turno).

## Fuera de alcance

Horas de MOD y plantilla (GAP de operarios del Excel), velocidad por formato dentro de una línea, escenarios
hipotéticos de turnos, ZT/semiterminados en líneas de llenado.
