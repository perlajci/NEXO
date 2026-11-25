# NEXO v0.2 · Población expuesta y respuesta a emergencias en Puebla

Prototipo para el **HackaTec 2026 · Reto HackaHer (SECIHTI Puebla)**: comunicación, localización de personas, identificación de necesidades y coordinación de recursos.

NEXO parte del censo del INEGI: antes de que llegue el primer reporte ya sabe **cuántas personas hay en la zona de riesgo y cuántas son vulnerables**. Con eso propone **dónde poner albergues**, lleva la cuenta de **expuestos vs. confirmados a salvo**, traza **rutas de atención** y recibe reportes de **nodos ESP32** (WiFi hoy, LoRa después).

## Herramientas (barra lateral)

| Sección | Qué hace |
|---|---|
| **Inicio** | Qué se puede hacer, estado de los datos y primeros pasos |
| **Mapa de riesgo** | Localidades en semáforo según fenómeno y mes; población estatal por nivel; filtros por municipio, nivel y tamaño; capas; **escuelas** en peligro y afectadas, con ficha, reporte de daño, presupuesto, ruta y corrección de ubicación. Ver [Escuelas en el mapa](#escuelas-en-el-mapa) |
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

### Inicio de sesión (`PIANI_CLAVE`, recomendado)

Con esta variable, el tablero pide una **contraseña del equipo** en una pantalla de inicio de sesión (`/login.html`):

```bash
PIANI_CLAVE=una_contraseña_larga npm start               # Git Bash, Linux, Render
$env:PIANI_CLAVE="una_contraseña_larga"; npm start       # PowerShell
```

**Nunca la escribas en el código ni la subas al repositorio**; en Render va en *Environment*. Sin la variable, PIANI funciona abierto, como antes, y lo avisa al arrancar.

- **Sesión:** dura 12 horas y se guarda en una cookie `HttpOnly`, que el JavaScript de la página no puede leer, marcada `Secure` en HTTPS. Las sesiones viven en memoria, así que al reiniciar el servidor hay que volver a entrar.
- **Intentos fallidos:** tras 5 desde la misma IP, el servidor pide esperar 1 minuto.
- **Sin sesión:** la API responde 401 y las páginas mandan al login; al entrar, se regresa a la sección que se estaba viendo. El botón **Cerrar sesión** está arriba a la derecha.
- **Rutas que siguen abiertas:** la página pública `cerca.html` (con `sw.js`, el manifiesto y `/api/albergues/publicos`), porque se usa sin internet, y `POST /api/lora/trama`, porque el puente USB y la puerta de enlace de los ESP32 no tienen sesión.

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

## Escuelas (`data/escuelas/*.csv`)

La fuente principal es el **Catálogo Nacional de Centros de Trabajo (CNCT) de la SEP** (`cnct2026.csv`, ~190 MB, todo el país). Para usarlo:

1. Copia `cnct2026.csv` en `data/escuelas/`.
2. `npm run escuelas:recortar`: guarda solo Puebla en `data/escuelas/escuelas_puebla.csv` (~11 MB, mismas columnas) y mueve el archivo nacional a `data/escuelas/original/`, para que el servidor no lo lea dos veces. El nacional está en `.gitignore`.
3. `npm run escuelas:revisar`: dice cuántas escuelas se leyeron, cuántas se descartaron por cada motivo, qué columnas se reconocieron y cuáles no, si trae latitud y longitud, y qué valores distintos traen tipo de centro, nivel, turnos y sostenimiento.

Un CSV nuevo se lee sin reiniciar; sin archivo, Inicio muestra un aviso y el servidor sigue funcionando. El lector solo toma los CSV de `data/escuelas/`, no los de sus subcarpetas.

También acepta otro CSV de la SEP con columnas `cct`, `nombre`, `latitud`, `longitud`, y el **DENUE del INEGI** (actividades `6111`, `6112` y `6113`). El DENUE no trae CCT ni alumnos: esos campos quedan vacíos y la escuela se identifica como `DENUE-<id>`. **PIANI nunca inventa una CCT, una coordenada ni una matrícula.**

### Registro de cada escuela

| Campo | En el CNCT sale de | Nota |
|---|---|---|
| `cct` | `cv_cct` | |
| `nombre` | `c_nombre` | |
| `tipo_ct` | `c_tipo` | Solo `escuela`, `plantel (media superior)`, `asistencial` (albergues escolares) y `centros de apoyo a la educación inicial del conafe` |
| `es_inmueble_escolar` | `c_tipo` | `false` en los centros CONAFE de inicial, que pueden funcionar en casas o espacios comunitarios: por defecto no salen en las obras del Tabulador, pero sí en el mapa y en los conteos de riesgo |
| `nivel` | `tiponivelsub_c_servicion2` agrupado | Uno de: inicial, preescolar, primaria, secundaria, media superior, superior, especial (CAM), formación para el trabajo. Si viene vacío y el tipo de centro lo dice, se toma de `c_tipo` (`plantel (media superior)` → media superior; CONAFE → inicial). Los albergues escolares quedan sin nivel |
| `nivel_origen` | | `servicion` o `c_tipo` (o `nivel`/`nombre_act` en otros CSV) |
| `servicion1`, `servicion2`, `servicion3` | `tiponivelsub_c_servicion1`, `…2`, `…3` | Valores originales (básica / primaria / general, etc.) |
| `sostenimiento`, `subcontrol` | `sostenimiento_c_control`, `sostenimiento_c_subcontrol` | Público o Privado; Federal, Estatal, Autónomo, etc. |
| `municipio`, `localidad`, `ambito` | `inmueble_c_nom_mun`, `inmueble_c_nom_loc`, `inmueble_c_nom_ambito` | Ámbito: urbano o rural |
| `domicilio` | vialidad + número exterior + asentamiento + código postal | El 0 en número o CP no se escribe |
| `lat`, `lon` | `inmueble_latitud`, `inmueble_longitud` | Decimal |
| `turnos` | `c_turno_01`, `c_turno_02`, `c_turno_03` | Lista sin el número ni “sin dato”: `["matutino", "vespertino"]` |
| `turnos_inactivos` | los mismos | Turnos marcados “(inactivo)”, sin esa marca |
| `alumnos` | — | **El CNCT no trae alumnos: queda vacío** |
| `fuente`, `decimales_coord`, `ubicacion_aproximada` | | Ver abajo |

“Sin Dato” o “sin dato” se guarda como vacío.

### Filtros, en este orden

Cada descarte se cuenta aparte, con su renglón, su CCT y el motivo.

1. **Entidad Puebla.** En el CNCT, por `inmueble_c_nom_ent` = “Puebla” (sin importar mayúsculas ni acentos). En otros archivos, por la clave de entidad (`cve_ent` = 21) o, si no la traen, por el inicio `21` de la CCT. En el CNCT el `21` de la CCT es solo una **revisión**: las de Puebla cuya CCT no empieza con 21 se cuentan aparte, pero no se descartan.
2. **Solo planteles.** En el CNCT, `c_tipo` debe ser `escuela`, `plantel (media superior)`, `asistencial` o `centros de apoyo a la educación inicial del conafe`. Los demás (administrativo, supervisión, biblioteca, rectoría, etc.) se descartan y se cuentan por valor. Rectoría queda fuera porque la universidad ya aparece como `escuela`. En el DENUE, las actividades que no son escuelas.
3. **CCT con formato válido** (2 dígitos + 3 letras + 4 dígitos + letra).
4. **Coordenadas:** vacías, en 0 o fuera del rectángulo que contiene al estado (latitud 17.8 a 20.9, longitud −99.1 a −96.7).

**Una escuela por CCT.** Si un archivo trae la CCT en un renglón por turno, PIANI deja un solo registro, **suma los alumnos de todos los turnos** y une la lista de `turnos`. Si un turno trae alumnos y otro no, la suma es un mínimo y se marca `alumnos_incompleto`. Un renglón con la misma CCT y los mismos turnos se cuenta como repetido. En el CNCT los turnos vienen en columnas y cada CCT aparece una sola vez.

### `decimales_coord`

Dice qué tan fino está **escrita** la coordenada en el archivo, no si la escuela está realmente en ese punto. El archivo de la SEP quita los ceros finales (`18.5938` puede ser `18.593800`), así que `media` y `baja` pueden ser más finas de lo que parecen.

| Valor | Decimales (de la menos fina entre latitud y longitud) | Equivale a |
|---|---|---|
| `alta` | 4 o más (o segundos con decimales) | ≈ 11 m o mejor |
| `media` | 3 (o segundos enteros) | ≈ 110 m |
| `baja` | 2 o menos | ≈ 1 km o más |

Las escuelas con `decimales_coord = baja` llevan `ubicacion_aproximada = true` y el mapa las dibuja con borde punteado.

### Inmueble (`inmueble_id`)

Varias CCT pueden funcionar en el mismo edificio (turnos, niveles o servicios distintos). Comparten `inmueble_id` las escuelas con **la misma coordenada redondeada a 5 decimales y la misma calle** (lo que va antes de la primera coma del domicilio, sin el número exterior: “Calle 9 Sur 145” y “Calle 9 Sur” son la misma calle; “Calle 9 Sur” y “Calle 21 Poniente”, no). Antes de comparar se escriben completas las abreviaturas de vialidad: Av. → Avenida, Blvd. → Bulevar, C. → Calle (al inicio), Priv. → Privada, Prol. → Prolongación, Calz. → Calzada.

La calle se compara porque el catálogo repite coordenadas genéricas: en el centro de Puebla, una misma coordenada tiene 166 CCT con 118 domicilios distintos. `coordenada_compartida` dice cuántas CCT más usan esa coordenada con otra calle; la ficha lo avisa como posible punto genérico.

- `/api/escuelas/resumen` cuenta escuelas y también inmuebles (“826 escuelas en peligro en 622 inmuebles”).
- Un reporte de daño en una CCT se aplica a todas las CCT de su inmueble.

### Riesgo por escuela (`lib/riesgo-escuelas.js`)

Mismo modelo que las localidades: **Riesgo = Peligro × (0.5 + 0.5 · V)**.

- **Peligro, en el punto de la escuela:** volcánico por distancia al cráter; sísmico con los sismos alrededor de la escuela, normalizado con el máximo de las localidades del estado para que sea comparable; lluvias y heladas con la celda climática más cercana y el mes elegido.
- **Vulnerabilidad (V):** la de la **localidad del censo más cercana**. La ficha muestra esa localidad y su distancia. A más de 5 km, `vulnerabilidad_referencial = true` y la ficha avisa que V es solo referencial. Si la localidad no tiene V (datos reservados), se usa 0.5, igual que en el mapa.
- **Municipio:** por el nombre que trae la escuela; si no coincide con el censo, el de la localidad más cercana.
- Se recalcula al cambiar fenómeno o mes en el encabezado.

**Definiciones** (iguales en toda la interfaz):

- **En peligro:** nivel de riesgo alto o muy alto con el fenómeno y el mes elegidos. Es una **estimación del modelo**.
- **Afectada:** escuela con al menos un reporte de daño leve o mayor. Es un **dato de campo**. Una escuela puede ser ambas cosas; afectada tiene prioridad visual.

### Escuelas en el mapa

Capa **Escuelas (cuadros)** en Mapa de riesgo, encima de las localidades (círculos). Cada señal significa una sola cosa:

| Señal | Significado |
|---|---|
| **Color del relleno** | Estado: rojo = afectada con daño grave o inhabitable · naranja = afectada con daño leve o moderado · amarillo = en peligro sin daño reportado · gris = sin riesgo alto |
| **Borde punteado** | Solo daño **por verificar** |
| **Cuadro hueco** | Ubicación dudosa: coordenada aproximada (`decimales_coord = baja`) o compartida por 3 o más inmuebles. La ficha dice cuál |

- **Filtro rápido:** En peligro + afectadas (por defecto), En peligro, Afectadas o Todas.
- **Agrupación:** en zoom lejano las escuelas se agrupan por celda de 56 px en el navegador, sin librerías (`public/escuelas-mapa.js`); el cuadro del grupo lleva el número de escuelas y el color del estado más urgente. Desde el zoom 12 se dibuja una escuela por cuadro, solo las que están a la vista.
- **Ficha** (clic en una escuela): estado, ubicación dudosa, riesgo con los cuatro fenómenos, vulnerabilidad y su localidad, población a 2 km, albergue más cercano, CCT del mismo inmueble y reportes (con “Marcar verificado”). Botones: **Reportar daño**, **Armar presupuesto** (abre el Tabulador con la obra y la CCT), **Cómo llegar** (la escuela queda como destino en Rutas) y **Corregir ubicación**.
- **Buscador** por CCT o nombre: centra el mapa y abre la ficha, aunque la escuela no entre en el filtro.
- **Corregir ubicación:** el cuadro se vuelve arrastrable; al soltarlo se confirma y se guarda en `data/escuelas/correcciones.json` con `fuente = "manual"`, **sin tocar el CSV**. Mueve todo el inmueble (todas sus CCT), hasta 20 km. La escuela queda con `fuente_coord = "manual"` y la coordenada original en `coord_original`. Ese archivo está en `.gitignore` y, como los demás datos de operación, se borra al reiniciar en Render gratuito.
- Al cambiar fenómeno o mes, la capa se vuelve a pedir junto con las localidades.
- **Enlaces:** `?fenomeno=sismico&mes=11` elige el escenario, `?lat=&lon=&z=` la vista y `?escuela=21DPR1273G` abre la ficha (por ejemplo `/?fenomeno=volcanico&mes=11&escuela=21DPR1273G#riesgo`).

### Reportes de daño (`lib/reportes-escuelas.js`)

Se guardan en `data/confirmaciones.json`, la misma capa que Operación, con tipo `escuela`. Cada reporte lleva: `cct`, `dano` (`sin_dano`, `leve`, `moderado`, `grave`, `inhabitable`), `descripcion`, `fecha_dano`, `origen` (`manual` desde la página, o `espnow`, `lora` o `wifi` desde un nodo ESP32), `estado` (`pendiente` o `verificado`) e `historial` (alta y cada cambio de estado).

- **Mismo inmueble:** un reporte en una CCT se aplica a todas las CCT de su `inmueble_id`, indicando de qué CCT vino (`deCct`).
- **Daño de la escuela:** el más grave entre los reportes **verificados**. Si solo hay pendientes, se toma el más grave de ellos y la escuela queda **por verificar**.
- **Afectada:** daño leve o mayor, verificado o por verificar. “Sin daño” no cuenta.

## ESP32 y LoRa

- `firmware/nodo-albergue/`: ESP32 con botones +1/−1/enviar. `MODO_WIFI` manda la trama directo a NEXO (se puede simular en Wokwi); `MODO_LORA` la manda por radio a 915 MHz.
- `firmware/puerta-enlace/`: ESP32 con LoRa que recibe tramas y las sube a NEXO por WiFi, **sin Raspberry Pi**, con cola si se cae internet.
- `POST /api/lora/trama` recibe `A|nombre|personas|capacidad|lat|lon|ag,me` y actualiza el registro del mismo albergue.
- **Campo opcional de escuela** (posición 8, antes de la nota): `<CCT>` o `<CCT>:<daño>`, por ejemplo `R|Brigada 3|12||19.0412|-98.4123|me|21DPR1273G:gr|Techo caído`. Daño abreviado: `sd` sin daño, `le` leve, `mo` moderado, `gr` grave, `in` inhabitable. Con daño se crea un reporte de escuela **pendiente** con el origen del nodo (`via`: espnow, lora o wifi). Si el campo 8 no tiene forma de CCT se toma como nota, así que las tramas anteriores no cambian. Una CCT que no está en el catálogo se anota en el reporte y no crea daño.
- Simulador sin placas: `npm run lora:simular -- "A|Alb Sec 12|85|150|19.04|-98.41|ag,me"`
- Diseño completo, escalabilidad y materiales: [`docs/propuesta-lora.md`](docs/propuesta-lora.md).

Los bocetos de firmware **no se han compilado en placa real**: revísalos con el hardware.

## Pruebas

`npm test` corre 105 pruebas (7 del inicio de sesión en `test/sesion.test.js`, 12 del lector de escuelas en `test/escuelas.test.js`, 9 del riesgo y la API de escuelas en `test/escuelas-riesgo.test.js`, 8 de reportes de daño en `test/escuelas-reportes.test.js` y 8 del mapa de escuelas en `test/escuelas-mapa.test.js`): lector del censo, geocercas, índice de riesgo, Gutenberg-Richter, climatología, API completa, municipios, albergues sugeridos, rutas sin conexión, decodificador de polilíneas de Google, tramas y el tabulador. Usan `test/fixture/iter/iter_prueba.csv`, `test/fixture/capcee/tabulador_prueba.csv` y `test/fixture/escuelas/`, con **cifras, precios, escuelas y CCT (`21ZZZ…`) inventados** solo para probar el código.

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
| GET | `/api/escuelas?fenomeno=&mes=&nivel=&mun=&estado=&buscar=&riesgo=&limite=` | Escuelas con peligro, vulnerabilidad, índice y nivel de riesgo, `enPeligro` y `afectada`, en columnas como `/api/localidades`. `nivel` = nivel educativo; `mun` = clave o nombre; `estado` = `peligro`, `afectada`, `peligro_afectada` o `todas`; `riesgo` = niveles de riesgo separados por coma. 409 con aviso si no hay escuelas |
| GET | `/api/escuelas/resumen?fenomeno=&mes=` | Total, en peligro, afectadas, alumnos expuestos (`null` y aviso si el catálogo no trae alumnos) y desglose por municipio, nivel educativo y nivel de riesgo |
| GET | `/api/escuela/:cct?fenomeno=&mes=` | Ficha: datos, localidad del censo más cercana y su distancia, avisos (vulnerabilidad referencial, coordenada aproximada o compartida, daño por verificar), CCT del mismo inmueble, riesgo con los cuatro fenómenos, población en 2 km, albergue más cercano, daño, reportes e historial (también acepta `DENUE-<id>`) |
| GET/POST | `/api/escuelas/:cct/reportes` | Reportes que aplican a la escuela (los de todo su inmueble) y su daño; alta `{dano, descripcion, fecha, origen, estado}` (400 si el daño o la fecha no son válidos) |
| PATCH | `/api/escuelas/:cct/reportes/:id` | `{estado: "verificado" \| "pendiente", nota}`; queda en el historial |
| POST/DELETE | `/api/escuelas/:cct/ubicacion` | Corrige la ubicación `{lat, lon, nota}` de todo el inmueble (dentro de Puebla y a 20 km o menos de la original; 400 si no) o la deshace |
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
- El inicio de sesión usa una sola contraseña del equipo (`PIANI_CLAVE`), sin cuentas por persona: no queda registro de quién hizo cada cambio. `POST /api/lora/trama` sigue abierto para los ESP32, así que cualquiera en la red podría mandar un reporte; para uso real, conviene agregar una clave por dispositivo.
- Privacidad: se guardan conteos por albergue, no datos personales.
