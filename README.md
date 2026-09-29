# Planificación Supply · bellochapplab

Aplicación web para el seguimiento de coberturas de producto terminado (PT) de Belloch y Yunsey.
Flask + SQLite, empaquetada en un contenedor Docker para el NAS.

## Qué hace (versión 1.0)

| Sección | Quién la ve | Contenido |
|---|---|---|
| Inicio | Todos | Resumen de la semana: reparto por estado, qué entra y sale de rotura respecto a la carga anterior, acciones abiertas y las 10 referencias más urgentes |
| Coberturas | Todos | Lista filtrable y ordenable de referencias (mandante, línea, marca, ABC, planificación, estado), descarga en CSV |
| Ficha de referencia | Todos | Proyección de stock a 12 meses, tabla mes a mes, entradas (OF y propuestas), venta de 12 meses, acciones y notas |
| Líneas | Todos | Estado por grupo de máquina y página de cada línea con su demanda y entradas |
| Reunión semanal | Todos (editan planificador y administrador) | Referencias que necesitan decisión y acciones abiertas con responsable y fecha |
| Datos | Administrador | Carga del MM_Supply (comprobar → publicar), historial de cargas y criterios del semáforo |
| Usuarios | Administrador | Alta de usuarios, roles, activación y contraseñas temporales |

Roles: **administrador** (todo), **planificador** (notas y acciones), **lector** (solo consulta).

Cada pantalla tiene su propia dirección (por ejemplo `#/ref/010010002400`), así que funcionan el botón de atrás y los enlaces directos.

## Instalación en el NAS

Requisitos: Docker con Compose (Container Manager de Synology, Portainer o `docker compose` por SSH).

1. Copia esta carpeta al NAS, por ejemplo en `/volume1/docker/planificacion-supply`.
2. Copia `.env.example` como `.env` y rellena al menos `ADMIN_USER`, `ADMIN_NAME` y `ADMIN_PASSWORD`.
3. Revisa el puerto en `docker-compose.yml` (por defecto `8085`).
4. Arranca:
   ```
   docker compose up -d --build
   ```
5. Abre `http://<ip-del-nas>:8085` y entra con el administrador del `.env`.
6. En **Datos**, sube el MM_Supply, pulsa **Comprobar fichero** y, si las cifras cuadran, **Publicar para todos**.

Si dejas `ADMIN_PASSWORD` vacío, se genera una contraseña temporal que aparece en el log del contenedor (`docker logs planificacion-supply`) y se pide cambiarla al entrar.

### HTTPS

Si la publicáis con el proxy inverso del NAS y un certificado, pon `COOKIE_SECURE=1` en el `.env` para que la cookie de sesión solo viaje por HTTPS.

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
| MM_Art | PT activos, estado, grupo de planificación, marca, lote, stock mínimo (Belloch), sucesor |
| MM_TLY | Lote y stock mínimo de Yunsey |
| MM_Stocks | Stock actual, suma de ambos mandantes |
| MM_Prev | Previsión (se usa la versión IDPrev más reciente) |
| MM_PedVentas | Pedidos pendientes con fecha de envío |
| MM_OF | OF abiertas (fecha fin `tterm`) |
| MM_PROP | Propuestas del MRP (fecha `wtterm`); las que ya tienen nº de OF se descartan para no contarlas dos veces |
| MM_Maq | Línea (grupo de máquina) de cada referencia |
| MM_Vtas | Venta mensual, para descontar lo ya vendido en el mes en curso y mostrar el histórico |

## Lógica de cálculo

- **Demanda del mes** = la mayor entre la previsión y los pedidos de ese mes (como consume ABAS). En el mes en curso se descuenta lo ya vendido; los pedidos con fecha pasada se suman al mes en curso.
- **Entradas** según el escenario elegido: solo OF, OF y propuestas fijadas, u OF y todas las propuestas.
- **Stock proyectado** a fin de mes = stock anterior − demanda + entradas.
- **Semáforo** (horizonte configurable, 3 meses por defecto):
  - Rotura: stock proyectado por debajo de 0 dentro del horizonte.
  - Bajo mínimo: por debajo del stock mínimo.
  - Pendiente de propuestas: con solo las OF habría problema y lo resuelven propuestas sin fijar, o hay una OF con fecha pasada.
  - Cubierto.
  - Sin demanda: tiene stock pero no tiene demanda prevista.
- **ABC** por mandante con la previsión de los 12 próximos meses: A < 45 %, B < 80 %, C < 95 %, D resto; bajo pedido = NA.

La lógica está en `app/core.py` (servidor) y su gemela de evaluación en `app/static/core.js` (navegador, para cambiar de escenario al instante). Si se cambia una, hay que cambiar la otra.

## Estructura

```
app/
  app.py          API, sesiones, roles y base de datos
  core.py         lectura del MM_Supply y cálculo de coberturas
  static/         aplicación web (index.html, app.js, app.css, core.js)
tests/test_api.py prueba de extremo a extremo: DATA_DIR=/tmp/prueba python tests/test_api.py MM_Supply.xlsx
```

## Pendiente para próximas versiones

- Stock bloqueado o en cuarentena (hoy cuenta dentro del stock).
- Capacidad por línea para comparar con la carga.
- Módulos de stock mínimo y lotes, desviación de previsiones y consolidador (ya visibles en el menú como "pronto").
