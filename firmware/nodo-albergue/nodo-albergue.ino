// NEXO · Nodo de albergue (ESP32)
// Lleva la cuenta de personas a salvo con dos botones y envía una trama corta:
//   A|<nombre>|<personas>|<capacidad>|<lat>|<lon>|<necesidades>
// Dos modos (elige uno abajo):
//   MODO_WIFI  -> la manda directo a NEXO por HTTP (sirve para el prototipo y en Wokwi).
//   MODO_LORA  -> la manda por radio LoRa 915 MHz a la puerta de enlace (sin internet).
// Placas probadas en diseño: TTGO LoRa32 / Heltec WiFi LoRa 32 V2 (radio SX1276).
// Para radios SX1262 (Heltec V3, XIAO+Wio) usa la biblioteca RadioLib o el firmware Meshtastic.
// Bibliotecas: "LoRa" de Sandeep Mistry (solo en MODO_LORA). WiFi y HTTPClient vienen con el ESP32.
// ESTADO: boceto sin compilar en placa real todavía.

#define MODO_WIFI   // cambia a MODO_LORA cuando tengas la radio
// #define MODO_LORA

#include <Arduino.h>
#ifdef MODO_WIFI
  #include <WiFi.h>
  #include <HTTPClient.h>
  #include <WiFiClientSecure.h>
  const char* WIFI_SSID = "Wokwi-GUEST";          // en Wokwi; cámbialo por tu red
  const char* WIFI_PASS = "";
  const char* NEXO_URL  = "https://TU-APP.onrender.com/api/lora/trama"; // NEXO publicado en internet
#endif
#ifdef MODO_LORA
  #include <SPI.h>
  #include <LoRa.h>
  // Pines típicos TTGO LoRa32 / Heltec V2 (SX1276). Revisa los de tu placa.
  #define LORA_SCK  5
  #define LORA_MISO 19
  #define LORA_MOSI 27
  #define LORA_SS   18
  #define LORA_RST  14   // TTGO LoRa32 v2.1 usa 23
  #define LORA_DIO0 26
  #define LORA_FREQ 915E6 // banda 902-928 MHz, espectro libre en México
#endif

// ---- Datos del albergue (edítalos antes de grabar) ----
const char* NOMBRE    = "Alb Primaria Juarez";  // corto: cada byte cuenta en LoRa
const int   CAPACIDAD = 150;
const char* LAT       = "19.0412";
const char* LON       = "-98.4123";
// Necesidades abreviadas: ag agua, al alimentos, me medicinas, am atención médica,
// co cobijas, tr traslado, en energía, cm comunicación
const char* NECESIDADES = "ag,me";

// ---- Botones ----
const int BTN_MAS    = 32;  // +1 persona
const int BTN_MENOS  = 33;  // -1 persona
const int BTN_ENVIAR = 25;  // envío inmediato
const int LED        = 2;
const unsigned long REENVIO_MS = 5UL * 60UL * 1000UL; // reenvía el estado cada 5 min

int personas = 0;
unsigned long ultimoEnvio = 0;
bool cambio = false;

bool presionado(int pin) {
  static unsigned long ultimo[40] = {0};
  if (digitalRead(pin) == LOW && millis() - ultimo[pin] > 250) { ultimo[pin] = millis(); return true; }
  return false;
}

String armarTrama() {
  return String("A|") + NOMBRE + "|" + personas + "|" + CAPACIDAD + "|" + LAT + "|" + LON + "|" + NECESIDADES;
}

void enviar() {
  String t = armarTrama();
  Serial.print("Enviando (" ); Serial.print(t.length()); Serial.print(" bytes): "); Serial.println(t);
  digitalWrite(LED, HIGH);
#ifdef MODO_WIFI
  if (WiFi.status() != WL_CONNECTED) { Serial.println("Sin WiFi, se reintenta luego"); digitalWrite(LED, LOW); return; }
  WiFiClientSecure cliente;
  cliente.setInsecure();               // solo prototipo: no valida el certificado
  HTTPClient http;
  http.begin(cliente, NEXO_URL);
  http.addHeader("Content-Type", "application/json");
  String cuerpo = String("{\"trama\":\"") + t + "\",\"via\":\"wifi\"}";
  int codigo = http.POST(cuerpo);
  Serial.print("Respuesta NEXO: "); Serial.println(codigo);
  http.end();
#endif
#ifdef MODO_LORA
  LoRa.beginPacket();
  LoRa.print(t);
  LoRa.endPacket();
  Serial.println("Paquete LoRa enviado");
#endif
  digitalWrite(LED, LOW);
  ultimoEnvio = millis();
  cambio = false;
}

void setup() {
  Serial.begin(115200);
  pinMode(BTN_MAS, INPUT_PULLUP);
  pinMode(BTN_MENOS, INPUT_PULLUP);
  pinMode(BTN_ENVIAR, INPUT_PULLUP);
  pinMode(LED, OUTPUT);
#ifdef MODO_WIFI
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  Serial.print("Conectando WiFi");
  for (int i = 0; i < 40 && WiFi.status() != WL_CONNECTED; i++) { delay(250); Serial.print("."); }
  Serial.println(WiFi.status() == WL_CONNECTED ? " listo" : " sin conexión");
#endif
#ifdef MODO_LORA
  SPI.begin(LORA_SCK, LORA_MISO, LORA_MOSI, LORA_SS);
  LoRa.setPins(LORA_SS, LORA_RST, LORA_DIO0);
  if (!LoRa.begin(LORA_FREQ)) { Serial.println("No se encontró la radio LoRa"); while (true) delay(1000); }
  LoRa.setSyncWord(0x4E);        // red privada NEXO (no se mezcla con otras redes LoRa)
  LoRa.setSpreadingFactor(9);    // equilibrio alcance / tiempo al aire
  LoRa.setSignalBandwidth(125E3);
  LoRa.enableCrc();
  Serial.println("Radio LoRa lista en 915 MHz");
#endif
  Serial.println("Nodo de albergue NEXO listo. Botones: +1, -1, enviar.");
}

void loop() {
  if (presionado(BTN_MAS))   { personas++; cambio = true; Serial.print("Personas: "); Serial.println(personas); }
  if (presionado(BTN_MENOS) && personas > 0) { personas--; cambio = true; Serial.print("Personas: "); Serial.println(personas); }
  if (presionado(BTN_ENVIAR)) enviar();
  // Envía solo si hubo cambios hace 20 s (agrupa varios clics) o cada 5 min como "sigo vivo".
  if ((cambio && millis() - ultimoEnvio > 20000) || millis() - ultimoEnvio > REENVIO_MS) enviar();
  delay(10);
}
