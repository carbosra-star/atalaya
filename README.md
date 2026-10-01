# Atalaya · Supply · bellochapplab

Aplicación web para el seguimiento de coberturas de producto terminado (PT) de Belloch y Yunsey.
Flask + SQLite, empaquetada en un contenedor Docker para el NAS.

## Qué hace (versión 1.0)

| Sección | Quién la ve | Contenido |
|---|---|---|
| Inicio | Todos | Resumen de la semana: reparto por estado, valor del stock, del exceso y sin demanda, qué entra y sale de rotura respecto a la carga anterior, acciones abiertas y las 10 referencias más urgentes |
| Coberturas | Todos | Lista filtrable y ordenable de referencias (mandante, línea, marca, ABC, planificación, estado), descarga en CSV |
| Ficha de referencia | Todos | Proyección de stock a 12 meses, tabla mes a mes, entradas (OF y propuestas), venta de 12 meses, acciones y notas |
| Líneas | Todos | Estado por grupo de máquina y página de cada línea con su demanda y entradas |
| Porfolio | Todos | Resumen del maestro, altas y bajas frente a la carga anterior (con su motivo), lanzamientos de los últimos 9 meses con lo que tienen preparado, PT activos sin movimiento e inactivos con stock (con su valor) |
| Stock mínimo y lotes | Todos (deciden planificador y administrador) | Lote y stock de seguridad por referencia (ERP, método Excel y estadístico), propuesta, decisiones con historial, valor en € por mandante y clase y fichero de cambios para ABAS |
| Reunión semanal | Todos (editan planificador y administrador) | Referencias que necesitan decisión y acciones abiertas con responsable y fecha |
| Datos | Administrador | Carga del MM_Supply (comprobar → publicar), historial de cargas y criterios del semáforo |
| Usuarios | Administrador | Alta de usuarios, roles, activación y contraseñas temporales |

Roles: **administrador** (todo), **planificador** (notas y acciones), **lector** (solo consulta).

Cada pantalla tiene su propia dirección (por ejemplo `#/ref/010010002400`), así que funcionan el botón de atrás y los enlaces directos.

## Instalación en el NAS

Requisitos: Docker con Compose (Container Manager de Synology, Portainer o `docker compose` por SSH).

1. Copia esta carpeta al NAS, por ejemplo en `/volume1/docker/atalaya`.
2. Copia `.env.example` como `.env` y rellena al menos `ADMIN_USER`, `ADMIN_NAME` y `ADMIN_PASSWORD`.
3. Revisa el puerto en `docker-compose.yml` (por defecto `8085`).
4. Arranca:
   ```
   docker compose up -d --build
   ```
5. Abre `http://<ip-del-nas>:8085` y entra con el administrador del `.env`.
6. En **Datos**, sube el MM_Supply, pulsa **Comprobar fichero** y, si las cifras cuadran, **Publicar para todos**.

Si dejas `ADMIN_PASSWORD` vacío, se genera una contraseña temporal que aparece en el log del contenedor (`docker logs atalaya`) y se pide cambiarla al entrar.

### HTTPS

Si la publicáis con el proxy inverso del NAS y un certificado, pon `COOKIE_SECURE=1` en el `.env` para que la cookie de sesión solo viaje por HTTPS.

Si todo el acceso pasa por ese proxy, pon también `TRUST_PROXY=1`: así el límite de intentos de acceso usa la IP real de cada usuario. Sin proxy déjalo a `0`, o cualquiera podría saltarse el límite falseando la cabecera `X-Forwarded-For`.

Las fechas se guardan en hora de `APP_TZ` (por defecto `Europe/Madrid`), aunque el contenedor esté en UTC.

### Copias de seguridad

Todo el estado está en la carpeta `./data`:
- `supply.db`: usuarios, cargas (se guardan las últimas 30), notas, acciones y criterios.
- `secret.key`: clave de las sesiones.

Basta con incluir esa carpeta en las copias del NAS (Hyper Backup o similar).

### Actualizar a una versión nueva

```
docker compose up -d --build
```
Los datos de `./data` se mantienen.

## Datos de entrada: MM_Supply.xlsx

Hojas que usa la app (las demás se ignoran):

| Hoja | Uso |
|---|---|
| MM_Art | PT activos, estado, grupo de planificación, marca, lote, stock mínimo de Belloch (`mindest`), sucesor |
| MM_TLY | Lote y stock mínimo de Yunsey |
| MM_Stocks | Stock actual, suma de ambos mandantes |
| MM_Prev | Previsión operativa: cada mes sale de la versión IDPrev más reciente que lo cubre |
| MM_PedVentas | Pedidos pendientes con fecha de envío |
| MM_OF | OF abiertas (fecha fin `tterm`) |
| MM_PROP | Propuestas del MRP (fecha `wtterm`, fijada si `fix`); las que ya tienen nº de OF se descartan para no contarlas dos veces |
| MM_Maq | Línea (grupo de máquina) de cada referencia |
| MM_Vtas | Venta mensual, para descontar lo ya vendido en el mes en curso y mostrar el histórico |

## Lógica de cálculo

- **Previsión operativa**: para cada mes se usa la versión más reciente que tenga ese mes (por ejemplo, el mes en curso de 2026Q3 y los siguientes de 2026Q4).
- **Demanda del mes** = la mayor entre la previsión y los pedidos de ese mes (como consume ABAS). En el mes en curso cuenta la menor entre (previsión − lo ya vendido) y la parte proporcional de los días naturales que quedan, hoy incluido; los pedidos con fecha pasada se suman al mes en curso.
- **Entradas** según el escenario elegido: solo OF, OF y propuestas fijadas, u OF y todas las propuestas.
- **Demanda/mes y cobertura**: la demanda/mes es la media de los 3 próximos meses completos (sin el mes en curso); la cobertura es stock de hoy ÷ demanda/mes.
- **Acierto de la previsión**: para los 12 últimos meses cerrados se compara la venta con la previsión vigente de cada mes (la última versión cuyo trimestre había empezado). El **factor de sesgo** es venta ÷ previsión en los meses que tenían previsión, propio con 6 meses o más de historia o, si no, el de su grupo mandante × ABC, siempre entre 0,5 y 1,5. El **error medio** es Σ|venta − previsión| ÷ venta.
- **Previsión corregida** (selector "Previsión"): la previsión × factor de sesgo. Por defecto se usa la previsión tal cual.
- **Cobertura prudente**: stock ÷ (demanda/mes con previsión corregida × (1 + error medio, con tope del 100 %)). Es informativa, no cambia el semáforo.
- **Stock proyectado** a fin de mes = stock anterior − demanda + entradas.
- **Semáforo** (horizonte configurable, 3 meses por defecto):
  - Rotura: stock proyectado por debajo de 0 dentro del horizonte.
  - Bajo mínimo: por debajo del stock mínimo.
  - A revisar (amarillo):
    - con solo las OF habría problema y lo resuelven propuestas sin fijar;
    - hay una OF con fecha pasada;
    - rotura antes de la entrada: el stock no llega a la primera entrada de este mes, con la demanda del mes repartida por igual en los días que quedan;
    - sin stock ni entradas (OF o propuestas) para la demanda de los 6 próximos meses, aunque empiece más allá del horizonte;
    - OF o propuestas sin demanda prevista en 12 meses.

    Los tres últimos solo se aplican a los contra stock: los bajo pedido se fabrican contra pedido.
  - Cubierto.
  - Exceso (solo contra stock): el stock de hoy supera el stock máximo (stock de seguridad + lote); si no tiene lote, la demanda de los próximos 6 meses en Belloch o 12 en Yunsey (configurable en Datos).
  - Sin demanda: no tiene demanda prevista en 12 meses, tenga stock o no.
- **Valor**: a coste, con el `Precio Mixto` del maestro. En Inicio: valor del stock, del exceso (stock − demanda de los meses de exceso) y del stock sin demanda. En Coberturas, la columna Valor enseña el exceso en las referencias en exceso, lo que falta (peor mes del horizonte) en las de rotura y el stock en el resto. Las referencias con stock y sin precio aparecen como "sin precio" y no suman.
- **Stock mínimo y lotes** (contra stock con ABC): lote = previsión de 12 meses ÷ fabricaciones al año de la clase (a miles desde 10.000, a centenas por debajo). Stock de seguridad método Excel = lote × % de la clase. Estadístico = z(nivel de servicio) × error típico relativo × previsión media del próximo trimestre × √(plazo en meses), con plazo = 15 días laborables + plazo extra de material; error > 100 % = irregular, menos de 6 meses con previsión = sin historia; sobreprevisión > 20 % no sube; límite ×0,5–×2 del ERP; redondeo a centenas; Yunsey no baja. La propuesta es el estadístico (o el ERP si no hay cifra), salvo cambios de menos del 10 % o 100 uds; las referencias a extinguir o sin previsión (en 12 meses o en el próximo trimestre) no tienen propuesta automática y se deciden a mano. Las decisiones se guardan con historial; el fichero para ABAS trae las pendientes y, al publicar una carga cuyo ERP ya las tiene, se marcan como aplicadas.
- **Stock máximo** = stock de seguridad + lote (decididos o del ERP). Es el criterio de exceso; sin lote, se usa la demanda de los meses de exceso.
- **Seguimiento**: entran los productos terminados activos del maestro (MM_Art) con algún movimiento (stock, previsión en 12 meses, pedidos, OF o propuestas en 12 meses, o venta en los últimos 13 meses), los que tienen previsión más allá de 12 meses en la versión vigente y todos los lanzamientos (altas de los últimos 9 meses), aunque todavía no tengan nada. Las altas y bajas se detectan solas en cada carga.
- **Porfolio**: un alta es "nueva" si tiene menos de 4 meses; los lanzamientos son las altas de los últimos 9 meses.
- **ABC** por mandante con Pareto sobre la venta en unidades de los 12 meses cerrados (cortes configurables en Datos, por defecto A < 45 %, B < 80 %, C < 95 %, D resto; la referencia que cruza un corte se queda en su clase); bajo pedido = NA. Con menos de 12 meses desde la primera venta se anualiza la venta media y con menos de 3 se usa la previsión de 12 meses: en ambos casos el ABC es provisional (*). Por mandante y clase se configuran también la frecuencia de fabricación y el % de SS, para el futuro módulo de stock mínimo y lotes.

La lógica está en `app/core.py` (servidor) y su gemela de evaluación en `app/static/core.js` (navegador, para cambiar de escenario al instante). Si se cambia una, hay que cambiar la otra.

## Estructura

```
app/
  app.py          API, sesiones, roles y base de datos
  core.py         lectura del MM_Supply y cálculo de coberturas
  parametros.py   stock mínimo, lote y stock máximo (sin gemela en el navegador)
  static/         aplicación web (index.html, app.js, app.css, core.js)
tests/test_api.py prueba de extremo a extremo: DATA_DIR=/tmp/prueba python tests/test_api.py MM_Supply.xlsx
                  (con Node.js instalado comprueba además que core.js y core.py dan el mismo semáforo)
tests/test_core.py    pruebas de la lógica con datos inventados: python tests/test_core.py
tests/test_parametros.py pruebas del cálculo de stock mínimo y lotes: python tests/test_parametros.py
tests/test_core_js.js pruebas de core.js sin gemela en Python: node tests/test_core_js.js
```

## Pendiente para próximas versiones

- Stock bloqueado o en cuarentena (hoy cuenta dentro del stock).
- Capacidad por línea para comparar con la carga.
- Módulos de desviación de previsiones y consolidador (ya visibles en el menú como "pronto").

## Deuda técnica y decisiones provisionales

- **Previsión operativa (provisional)**: hoy se coge, mes a mes, la versión más reciente que cubre ese mes. El objetivo es montar una previsión operativa eligiendo explícitamente qué meses se toman de cada iteración.
- **Cantidad de las OF**: se usa `mge` de MM_OF. Pendiente de confirmar que es la cantidad pendiente (no la total) o de recibir esa columna en el MM_Supply.
- **OF con fecha pasada**: se mantienen en amarillo ("OF con fecha pasada") a propósito, aunque muchas sean OF en curso o terminadas sin cerrar.
- **Acierto y corrección de la previsión (provisional)**: parámetros fijos (12 meses, 6 meses mínimos, límites 0,5–1,5, grupo mandante × ABC). Se revisarán con el módulo de desviación de previsiones y el de stock mínimo.
