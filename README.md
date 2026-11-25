# NEXO v0.2 · Población expuesta y respuesta a emergencias en Puebla

Prototipo para el **HackaTec 2026 · Reto HackaHer (SECIHTI Puebla)**: comunicación, localización de personas, identificación de necesidades y coordinación de recursos.

NEXO parte del censo del INEGI: antes de que llegue el primer reporte ya sabe **cuántas personas hay en la zona de riesgo y cuántas son vulnerables**. Con eso propone **dónde poner albergues**, lleva la cuenta de **expuestos vs. confirmados a salvo**, traza **rutas de atención** y recibe reportes de **nodos ESP32** (WiFi hoy, LoRa después).

## Herramientas (barra lateral)

| Sección | Qué hace |
|---|---|
| **Inicio** | Qué se puede hacer, estado de los datos y primeros pasos |
| **Mapa de riesgo** | Localidades en semáforo según fenómeno y mes; población estatal por nivel; filtros por municipio, nivel y tamaño; capas |
| **Contar población** | Círculo, polígono o zonas rápidas (Popocatépetl 12/30 km, ceniza según viento, todo el estado): población, grupos vulnerables, viviendas, localidades prioritarias, CSV |
| **Municipios** | Tablero estatal: indicadores, ranking ordenable (riesgo, % en riesgo alto, población, vulnerabilidad, 60+, 0–2, discapacidad), buscador y **ficha de cada municipio** con sismos y clima |
| **Albergues sugeridos** | Modelo de cobertura máxima: sedes **fuera de la zona de peligro** que alcanzan a más personas en riesgo, ponderadas por vulnerabilidad; capacidad sugerida; localidades sin cubrir; registrar la propuesta como albergue |
| **Operación** | Registro de albergues, **bases de respuesta** (Protección Civil, Cruz Roja, hospitales) y reportes; expuestos vs. confirmados vs. sin confirmar |
| **Tabulador** | Precios de referencia para obra escolar (CAPCEE): catálogo con tipo de dato y fuente, **presupuestos por partida** con IVA aparte, presupuestos guardados con copia fija de precios, exportación a CSV y carga de tabulador nuevo con historial. Ver [Tabulador de obra escolar](#tabulador-de-obra-escolar-capcee) |
| **Rutas** | Emergencia ← base más cercana, o emergencia → albergue más cercano; distancia y tiempo; enlace para abrir en Google Maps desde el celular |
| **Sismos** | Historial, valor b de Gutenberg-Richter y periodo de retorno de un M≥6 en el punto elegido |
| **Clima** | Pronóstico de 7 días y lluvia y heladas promedio por mes |
| **Ayuda** | Fuentes, método, limitaciones y glosario |

El **escenario** (fenómeno y mes) está en la barra superior y recalcula todo.

**Página pública** `cerca.html`: "¿Cuál es mi albergue más cercano?". Se guarda en el teléfono la primera vez que se abre (service worker) y después **funciona sin internet** con el GPS del teléfono: distancia, flecha de dirección y lugares libres.

## Puesta en marcha

1. Node.js 18 o superior. No usa paquetes de npm.
2. **Censo:** en SCITEL del INEGI (<https://www.inegi.org.mx/app/scitel/default?ev=9>), fila **Puebla**, botón **CSV**. Guárdalo en `data/iter/iter_puebla_2020.csv`.
3. **Datos de APIs** (una vez, ~10 min): `npm run preparar`
4. `npm start` y abre <http://localhost:3000>. La página pública queda en <http://localhost:3000/cerca.html>.

### Google Maps para las rutas (opcional)

Sin llave, las rutas usan OpenStreetMap con el servidor de demostración de OSRM (sin tráfico; solo para prototipo). Con Google:

1. En Google Cloud, crea un proyecto, activa la **Routes API** y crea una llave de API (restríngela a esa API).
2. Arranca con la llave: `GOOGLE_MAPS_API_KEY=tu_llave npm start` (en Render, agrégala en *Environment*).

Google cobra por uso con un tope mensual gratuito: pon alertas de presupuesto. El enlace "Abrir en Google Maps" de cada ruta no usa la llave ni cuesta.

Sin internet, NEXO estima en línea recta (con factor de rodeo de 1.3 y 40 km/h) y lo indica.

### Clave para cargar un tabulador nuevo (`TABULADOR_ADMIN_KEY`, opcional)

PIANI no tiene cuentas de usuario, así que el botón **Cargar tabulador** (sección Tabulador → Actualizar precios) solo funciona si el servidor tiene esta variable de entorno y quien carga el archivo escribe la misma clave:

```bash
TABULADOR_ADMIN_KEY=una_clave_larga_y_dificil npm start
```

En Render, agrégala en *Environment*, igual que `GOOGLE_MAPS_API_KEY`. **Nunca la escribas en el código ni la subas al repositorio.** Sin la variable, el botón aparece desactivado y los precios se cambian editando `data/capcee/tabulador.csv` en el repositorio. Cada vez que se aplica o restaura un tabulador, el anterior se guarda en `data/capcee/historial/`.

> **Aviso: Render gratuito.** El disco se borra al reiniciar: **el tabulador cargado desde la página y su historial se pierden y vuelve el CSV del repositorio.** Para conservar un tabulador nuevo, súbelo al repositorio como `data/capcee/tabulador.csv` (o usa una base de datos).

## Tabulador de obra escolar (CAPCEE)

Sección **Tabulador** de la barra lateral. Tiene cuatro vistas:

- **Catálogo:** búsqueda y filtros por capítulo y tipo de dato. Cada precio lleva su etiqueta y su fuente.
- **Armar presupuesto:** obra, CCT opcional y factor; subtotal, IVA 16 % aparte, total y desglose por capítulo → partida genérica → partida específica.
- **Guardados:** ver, exportar a CSV y borrar presupuestos.
- **Actualizar precios:** cargar un tabulador nuevo con vista previa de cambios, e historial de versiones.

PIANI prepara y prioriza la información; **no sustituye al sistema contable ni presupuestal del estado.**

### Formato del CSV (`data/capcee/tabulador.csv`)

UTF-8 con BOM (en Excel: “CSV UTF-8 (delimitado por comas)”), un concepto por renglón, con estas columnas en cualquier orden:

| Columna | Regla |
|---|---|
| `clave_ref` | Obligatoria y única |
| `concepto` | Obligatorio |
| `unidad` | Una de: `m2`, `m3`, `m`, `pza`, `juego`, `plantel`, `%` |
| `precio_unitario_mxn_sin_iva` | Número mayor que 0, **sin IVA**. En los conceptos con unidad `%` es el porcentaje |
| `capitulo` | Cuatro dígitos: `2000`, `3000`, `5000` o `6000` |
| `partida_generica_conac` | Partida genérica del clasificador del CONAC, p. ej. `612 Edificación no habitacional` |
| `partida_especifica_cogape` | Partida específica del COGAPE de Puebla; vacía = “Pendiente COGAPE” |
| `factor_regional` | Número mayor que 0; vacío = 1 |
| `tipo_dato` | `OFICIAL CAPCEE`, `REFERENCIA PÚBLICA` o `ESTIMADO` (sin importar acentos ni mayúsculas) |
| `fuente` | Texto que se muestra al pasar el cursor por la etiqueta |

Al leer el archivo, un renglón inválido se descarta y se reporta con su número y motivo; los demás conceptos siguen disponibles. Al **cargar** un tabulador nuevo desde la página, en cambio, cualquier error bloquea la carga completa. Si falta el archivo o una columna, la sección muestra un aviso y el servidor sigue funcionando.

### Cómo se calcula un presupuesto (`lib/presupuesto.js`)

- **Importe** = cantidad × precio × factor del concepto × factor del presupuesto, redondeado a 2 decimales por renglón.
- **Conceptos con %:** se calculan sobre la suma de la obra del capítulo 6000 ya ajustada. No llevan factores, no entran en esa suma y llevan cantidad 1.
- **IVA 16 %:** en una línea aparte; los precios unitarios nunca lo incluyen.
- **Validaciones:** se rechazan la cantidad 0 o negativa y los conceptos repetidos o inexistentes. La obra es obligatoria. El CCT es opcional, con formato de Puebla (`21` + 3 letras + 4 dígitos + letra) y se guarda en mayúsculas.
- **Aviso:** si hay conceptos ESTIMADOS, se muestra “Este presupuesto usa precios estimados; no es un costo oficial” arriba del total y en el CSV.
- **Cálculo en el servidor:** el servidor calcula todo y nunca guarda totales que mande el navegador.

### Presupuestos guardados

Se guardan en `data/presupuestos.json`, con la misma capa que Operación, detrás de la interfaz `guardar`, `listar`, `obtener` y `borrar` de `lib/almacen.js`. Cada presupuesto guarda una **copia fija** de concepto, unidad, precio, factores, capítulo y partidas, además de la fecha y la **huella** (SHA-256) del tabulador. Un tabulador nuevo no los cambia; si sus precios difieren de los actuales, se marcan “calculado con tabulador anterior”.

El CSV exportado lleva UTF-8 con BOM, encabezado, renglones, subtotales por capítulo y por partida genérica, subtotal, IVA y total. Se llama `presupuesto_<obra>_<fecha>.csv`.

El botón **Usar en Recursos CAPCEE** marca el presupuesto para el futuro módulo de asignación por fuente y priorización. Ese módulo leerá `GET /api/presupuestos?recursos=1` y el objeto que describe `paraRecursosCapcee()` en `lib/presupuestos.js`.

### Actualizar precios e historial

Requiere `TABULADOR_ADMIN_KEY` (ver [Puesta en marcha](#clave-para-cargar-un-tabulador-nuevo-tabulador_admin_key-opcional)). El flujo es:
1. **Previsualizar:** se valida el archivo y se ven los conceptos nuevos, eliminados y modificados, y cuántos presupuestos guardados usan cada uno. No se aplica nada.
2. **Aplicar:** se confirma en un diálogo de la página.
3. **Respaldo:** antes de reemplazar, el vigente se copia a `data/capcee/historial/tabulador_<AAAA-MM-DD_HHMMSS hora de Puebla>_<huella corta>.csv`. El nuevo se escribe de forma atómica (archivo temporal + renombrar).

Desde el historial se puede **restaurar** una versión, también con clave y con respaldo previo. `data/capcee/historial/` está en `.gitignore`.

> **Render gratuito:** al reiniciar se borran `data/presupuestos.json`, `data/capcee/historial/` y cualquier tabulador cargado desde la página, y vuelve el CSV del repositorio. Para conservar un tabulador nuevo, súbelo al repositorio como `data/capcee/tabulador.csv`; para conservar presupuestos, expórtalos a CSV o usa una base de datos.

### Catálogo de planteles (opcional, `data/capcee/planteles.csv`)

Todavía no existe. Cuando lo agregues, con al menos la columna `cct` y de preferencia `nombre`, `municipio`, `localidad`, `lat` y `lon` (UTF-8, una escuela por renglón), cada presupuesto con CCT se enlaza solo con su plantel en el campo `plantel`. No hay que reiniciar ni cambiar código: lo leen `cargarPlanteles` y `buscarPlantel` en `lib/presupuesto.js`.

## ESP32 y LoRa

- `firmware/nodo-albergue/`: ESP32 con botones +1/−1/enviar. `MODO_WIFI` manda la trama directo a NEXO (se puede simular en Wokwi); `MODO_LORA` la manda por radio a 915 MHz.
- `firmware/puerta-enlace/`: ESP32 con LoRa que recibe tramas y las sube a NEXO por WiFi, **sin Raspberry Pi**, con cola si se cae internet.
- `POST /api/lora/trama` recibe `A|nombre|personas|capacidad|lat|lon|ag,me` y actualiza el registro del mismo albergue.
- Simulador sin placas: `npm run lora:simular -- "A|Alb Sec 12|85|150|19.04|-98.41|ag,me"`
- Diseño completo, escalabilidad y materiales: [`docs/propuesta-lora.md`](docs/propuesta-lora.md).

Los bocetos de firmware **no se han compilado en placa real**: revísalos con el hardware.

## Pruebas

`npm test` corre 61 pruebas: lector del censo, geocercas, índice de riesgo, Gutenberg-Richter, climatología, API completa, municipios, albergues sugeridos, rutas sin conexión, decodificador de polilíneas de Google, tramas y el tabulador. Usan `test/fixture/iter/iter_prueba.csv` y `test/fixture/capcee/tabulador_prueba.csv`, con **cifras y precios inventados** solo para probar el código.

Pruebas del tabulador (40):

| Archivo | Pruebas | Qué cubre |
|---|---|---|
| `test/tabulador.test.js` | 8 | Lector del CSV (BOM, comas entre comillas, tipos sin acento), renglones rechazados con motivo, archivo sin columnas o inexistente, filtros y resumen, `GET /api/tabulador` y `/resumen`, cálculo por API, aviso 409 sin archivo |
| `test/presupuesto.test.js` | 10 | Importe por renglón, ambos factores, conceptos % sobre la base del capítulo 6000, IVA 16 %, redondeo por renglón, cantidad 0 o negativa, presupuesto vacío, aviso de estimados y desglose, CCT de Puebla, catálogo de planteles |
| `test/presupuestos.test.js` | 10 | Almacén JSON, nombre del CSV, guardar y recuperar, recálculo que ignora totales falsos, rechazos, CSV (BOM, encabezado, partidas, totales), protección contra fórmulas en Excel, tabulador nuevo sin cambiar lo guardado, Recursos CAPCEE, borrar |
| `test/tabulador-admin.test.js` | 12 | CSV válido y con errores (renglón y motivo, UTF-8, 1 MB), diferencias con $ y % y presupuestos que usan cada concepto, escritura atómica ante fallas, nombre del respaldo, clave (401/403), previsualizar sin aplicar, 409 si algo cambió, aplicar con respaldo sin reiniciar, historial y restaurar |

## Despliegue en Render

*Web Service*, start command `npm start`, sin build. Sube el CSV del censo y `data/cache/` ya llena. En el plan gratuito el disco se borra al reiniciar: los registros de `data/confirmaciones.json` se pierden (para algo más que una demo, usar una base de datos).

> **Aviso: presupuestos guardados del Tabulador.** Se guardan en `data/presupuestos.json`, con la misma capa que Operación. **En el plan gratuito de Render el disco se borra al reiniciar y se pierden todos los presupuestos guardados.** Exporta a CSV los que necesites conservar. El guardado está detrás de una interfaz (`guardar`, `listar`, `obtener`, `borrar` en `lib/almacen.js`): para pasar a una base de datos basta con escribir otro objeto con esos cuatro métodos y cambiar una línea en `server.js`.

## API

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/estado` | Datos cargados, proveedor de rutas, catálogos |
| GET | `/api/localidades?fenomeno=&mes=` | Localidades con vulnerabilidad, peligro, riesgo y nivel |
| GET | `/api/municipios` · `/api/municipios/resumen` · `/api/municipio/:mun` | Lista, tablero estatal y ficha municipal |
| POST | `/api/geocerca` | Conteo en círculo o polígono con filtros |
| POST | `/api/albergues/sugerir` | `{fenomeno, mes, k, radioKm, pobMinCandidato, porcentajeAlbergue, niveles, mun}` |
| GET | `/api/ruta?origen=lat,lon&destino=lat,lon` | Ruta (Google, OSRM o estimada) |
| GET | `/api/cercano?lat=&lon=&tipo=albergue\|base` | Los 5 puntos más cercanos |
| GET | `/api/albergues/publicos` | Lista pública mínima para `cerca.html` |
| POST | `/api/lora/trama` | Trama de un nodo ESP32 |
| GET/POST/DELETE | `/api/confirmaciones` | Albergues, bases y reportes |
| GET | `/api/tabulador?buscar=&capitulo=&tipo=` | Conceptos del tabulador filtrados (409 con aviso si falta el CSV) |
| GET | `/api/tabulador/resumen` | Conceptos por capítulo y por tipo de dato |
| POST | `/api/presupuesto/calcular` | `{obra, cct, factor, renglones:[{clave_ref, cantidad}]}`; calcula sin guardar (400 con la lista de errores) |
| GET/POST | `/api/presupuestos` | Lista (`?recursos=1`: marcados para Recursos CAPCEE) y guardar; el servidor recalcula |
| GET/DELETE | `/api/presupuestos/:id` | Presupuesto guardado (con comparación contra el tabulador actual) y borrar |
| GET | `/api/presupuestos/:id/csv` | Exportación para Excel |
| POST | `/api/presupuestos/:id/recursos` | Marca para el futuro módulo Recursos CAPCEE |
| GET | `/api/tabulador/historial` | Si la carga está habilitada, tabulador vigente y versiones anteriores |
| POST | `/api/tabulador/previsualizar` | 🔒 Cuerpo: el CSV (máx. 1 MB). Valida y compara sin aplicar (422 con errores) |
| POST | `/api/tabulador/aplicar` | 🔒 Cuerpo: el CSV; encabezados `X-Huella-Base` y `X-Huella-Nueva` de la previsualización (409 si algo cambió) |
| POST | `/api/tabulador/restaurar` | 🔒 `{archivo}` de una versión del historial |

🔒 = requiere el encabezado `X-Admin-Key` igual a `TABULADOR_ADMIN_KEY`. Sin la variable en el servidor responde 403, sin clave 401 y con clave equivocada 403.
| GET | `/api/sismos` · `/api/clima` · `/api/ceniza` | Estadística sísmica, clima, cono de ceniza |

## Limitaciones

- El censo cuenta dónde vive la gente (de noche), no dónde está a cada hora, y es de 2020.
- Las localidades pequeñas tienen datos reservados por el INEGI: los conteos de grupos son un mínimo.
- El índice de riesgo es relativo y sirve para priorizar; no sustituye al Atlas Nacional de Riesgos ni a los mapas de peligro del CENAPRED.
- Los albergues sugeridos son localidades, no inmuebles: hay que verificar escuela o deportivo, estructura, servicios y accesos.
- Las rutas no conocen los cierres de vías provocados por el desastre.
- Los sismos no se predicen; la climatología usa 2020–2024 por los límites de la API gratuita.
- Sin usuarios ni contraseñas: hay que agregarlos antes de un uso real.
- Privacidad: se guardan conteos por albergue, no datos personales.
