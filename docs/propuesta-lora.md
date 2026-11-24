# Propuesta: red de comunicación de emergencia con ESP32 + LoRa (v0.2)

**Estado:** propuesta con bocetos de firmware. Falta el hardware. El servidor de NEXO ya recibe las tramas en `POST /api/lora/trama`.

## 1. Qué resuelve y qué no

- **Sí:** que albergues y brigadas reporten **sin red celular ni internet** cuántas personas tienen y qué necesitan, y que eso llegue al tablero de NEXO.
- **No:** detectar ni localizar personas. LoRa solo conoce los nodos que existen. El conteo de personas sale del censo (expuestos) y de lo que reporta cada albergue (confirmados).

## 2. ¿Raspberry Pi o solo ESP32?

**Para el prototipo y la primera etapa: solo ESP32.** Una placa ESP32 con radio LoRa tiene también WiFi, así que puede ser la puerta de enlace sin Raspberry:

```
[Nodo albergue ESP32+LoRa] ──LoRa 915 MHz──► [Puerta de enlace ESP32+LoRa] ──WiFi/internet──► NEXO (Render)
        botones +1 / −1                          cola si no hay internet
```

| | Solo ESP32 | ESP32 + Raspberry Pi |
|---|---|---|
| Costo y consumo | Bajo; funciona con batería o panel solar | Mayor; la Pi necesita fuente estable |
| Necesita internet en la puerta de enlace | **Sí**, para subir a NEXO en la nube (guarda en cola mientras no hay) | No: la Pi corre NEXO **localmente** y el puesto de mando lo abre por WiFi local |
| Complejidad | Baja (un solo programa) | Media (Linux + Node + lectura por puerto serie) |
| Cuándo conviene | Prototipo; zonas donde el puesto de mando sí tiene internet (satelital, fibra) | Cuando el puesto de mando **también** se queda sin internet |

**Recomendación:** empezar con solo ESP32 (incluido en `firmware/`) y dejar la Raspberry como opción para el puesto de mando aislado. La puerta de enlace también imprime cada trama por el puerto serie (`TRAMA|rssi|...`), así que después se puede conectar a una Pi o PC sin cambiar los nodos.

## 3. Red interna solo para brigadistas y encargados de albergue

- **Red privada:** los nodos usan una palabra de sincronía propia (`0x4E`), así que no se mezclan con otras redes LoRa. Para la versión real hay dos caminos:
  1. **Meshtastic** (recomendado para escalar): canales cifrados con clave propia; solo quien tiene la clave lee y escribe. Ya incluye reenvío en malla y puerta de enlace por WiFi (MQTT) en placas ESP32.
  2. **Firmware propio** (el de `firmware/`): más simple de explicar en la demo, pero habría que agregar cifrado, confirmaciones y reenvío.
- **Quién tiene nodo:** cada albergue, cada brigada en campo y el puesto de mando. Las bases de respuesta (Protección Civil, Cruz Roja) pueden tener uno para recibir avisos.
- **Formato de trama** (≤ 60 bytes con abreviaturas): `A|Alb Primaria Juarez|85|150|19.0412|-98.4123|ag,me`
  `A` albergue · `R` reporte de brigada · `B` base. Necesidades: `ag` agua, `al` alimentos, `me` medicinas, `am` atención médica, `co` cobijas, `tr` traslado, `en` energía, `cm` comunicación.

## 4. ¿Se puede escalar a toda la población?

**No conviene que cada persona tenga un nodo LoRa.** LoRa transmite muy pocos datos y todos comparten el mismo canal: con muchos nodos la red se satura. Meshtastic recomienda cambiar de configuración cuando una red pasa de unos 60 nodos cercanos, y su firmware recuerda del orden de 200 nodos. Una red estatal para millones de personas no es viable así.

**Lo que sí escala, por niveles:**

| Nivel | Quién | Cómo | Sin internet |
|---|---|---|---|
| 1. Red LoRa interna | Brigadas, albergues, puesto de mando (decenas a pocos cientos de nodos) | ESP32 + LoRa / Meshtastic | ✅ |
| 2. Página pública "albergue más cercano" | Cualquier persona con celular | `cerca.html` de NEXO: se guarda en el teléfono la primera vez y usa el **GPS, que funciona sin internet** | ✅ (después de abrirla una vez con internet) |
| 3. Punto de información en albergues y plazas | Personas cerca de un albergue | ESP32 como punto WiFi sin internet con una página local (lista de albergues, "estoy a salvo") que se reenvía por LoRa | ✅ (pero cada ESP32 atiende pocos teléfonos a la vez, del orden de 10 a 15) |
| 4. Alertas masivas | Toda la población | Canales oficiales: alerta sísmica, alertas a celulares del gobierno, radio | Depende del canal |

**Mensaje para el jurado:** "LoRa no es para que cada persona chatee; es la red de coordinación de quienes atienden la emergencia. Para la población, NEXO da una página que funciona sin internet con el GPS del teléfono."

## 5. Material (cotizar en México)

| Componente | Prototipo mínimo | Nota |
|---|---|---|
| ESP32 con LoRa **915 MHz** (TTGO LoRa32 o Heltec WiFi LoRa 32 V2) | 2 (nodo + puerta de enlace) | Los bocetos usan radio SX1276. Las placas con SX1262 (Heltec V3) necesitan RadioLib o Meshtastic |
| Antena 915 MHz | 2 | Nunca transmitir sin antena conectada |
| 3 botones + LED | 1 juego | Para el nodo de albergue |
| Batería LiPo o power bank | 2 | |
| Raspberry Pi | Opcional | Solo para el puesto de mando sin internet |

## 6. Plan de demostración

1. **Hoy, sin hardware:** abrir `firmware/nodo-albergue` en Wokwi (ESP32 + 3 botones) en `MODO_WIFI` con NEXO publicado en Render: cada clic cambia el número y aparece en el tablero. El radio LoRa no se puede simular; se explica con el diagrama.
2. **Sin placas ni Wokwi:** `npm run lora:simular -- "A|Alb Sec 12|85|150|19.04|-98.41|ag,me"`.
3. **Con 2 placas:** grabar `nodo-albergue` (cambiando a `MODO_LORA`) y `puerta-enlace`; pruebas de alcance grabadas en video antes del evento.

## 7. Pruebas propuestas

1. Alcance en línea de vista y en zona urbana (distancia con 95 % de entrega).
2. Tiempo desde el clic en el nodo hasta que aparece en NEXO.
3. Comportamiento de la cola de la puerta de enlace con el WiFi apagado.
4. Autonomía con batería reportando cada 5 minutos.
