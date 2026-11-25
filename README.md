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

## ESP32 y LoRa

- `firmware/nodo-albergue/`: ESP32 con botones +1/−1/enviar. `MODO_WIFI` manda la trama directo a NEXO (se puede simular en Wokwi); `MODO_LORA` la manda por radio a 915 MHz.
- `firmware/puerta-enlace/`: ESP32 con LoRa que recibe tramas y las sube a NEXO por WiFi, **sin Raspberry Pi**, con cola si se cae internet.
- `POST /api/lora/trama` recibe `A|nombre|personas|capacidad|lat|lon|ag,me` y actualiza el registro del mismo albergue.
- Simulador sin placas: `npm run lora:simular -- "A|Alb Sec 12|85|150|19.04|-98.41|ag,me"`
- Diseño completo, escalabilidad y materiales: [`docs/propuesta-lora.md`](docs/propuesta-lora.md).

Los bocetos de firmware **no se han compilado en placa real**: revísalos con el hardware.

## Pruebas

`npm test` corre 21 pruebas: lector del censo, geocercas, índice de riesgo, Gutenberg-Richter, climatología, API completa, municipios, albergues sugeridos, rutas sin conexión, decodificador de polilíneas de Google y tramas. Usan `test/fixture/iter/iter_prueba.csv`, con **cifras inventadas** solo para probar el código.

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
