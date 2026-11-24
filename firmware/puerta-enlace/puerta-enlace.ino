// NEXO · Puerta de enlace LoRa -> NEXO (ESP32, SIN Raspberry Pi)
// Escucha las tramas de los nodos de albergue por LoRa 915 MHz y las sube a NEXO por WiFi.
// Si no hay internet, las guarda en una cola (hasta 30) y las reenvía cuando vuelva.
// También las imprime por el puerto serie: así una PC o Raspberry con NEXO local puede leerlas.
// Placas: TTGO LoRa32 / Heltec WiFi LoRa 32 V2 (SX1276). Biblioteca: "LoRa" de Sandeep Mistry.
// ESTADO: boceto sin compilar en placa real todavía.

#include <Arduino.h>
#include <SPI.h>
#include <LoRa.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>

const char* WIFI_SSID = "TU_RED";
const char* WIFI_PASS = "TU_CLAVE";
const char* NEXO_URL  = "https://TU-APP.onrender.com/api/lora/trama"; // o http://IP-local:3000/api/lora/trama
const char* PUERTA    = "PE-Centro";  // nombre de esta puerta de enlace

#define LORA_SCK  5
#define LORA_MISO 19
#define LORA_MOSI 27
#define LORA_SS   18
#define LORA_RST  14   // TTGO LoRa32 v2.1 usa 23
#define LORA_DIO0 26
#define LORA_FREQ 915E6

const int MAX_COLA = 30;
String cola[MAX_COLA];
int rssiCola[MAX_COLA];
int enCola = 0;

bool valida(const String& t) {
  return t.length() > 8 && t.length() < 200 && (t.startsWith("A|") || t.startsWith("R|") || t.startsWith("B|"));
}

bool subir(const String& t, int rssi) {
  if (WiFi.status() != WL_CONNECTED) return false;
  WiFiClientSecure cliente;
  cliente.setInsecure();   // solo prototipo
  HTTPClient http;
  http.begin(cliente, NEXO_URL);
  http.addHeader("Content-Type", "application/json");
  String cuerpo = String("{\"trama\":\"") + t + "\",\"via\":\"lora\",\"rssi\":" + rssi + ",\"puerta\":\"" + PUERTA + "\"}";
  int codigo = http.POST(cuerpo);
  http.end();
  Serial.print("NEXO respondió "); Serial.println(codigo);
  return codigo == 200 || codigo == 201;
}

void encolar(const String& t, int rssi) {
  // Si ya hay una trama del mismo albergue, se reemplaza: solo importa el último estado.
  String clave = t.substring(0, t.indexOf('|', 2));
  for (int i = 0; i < enCola; i++) if (cola[i].startsWith(clave + "|")) { cola[i] = t; rssiCola[i] = rssi; return; }
  if (enCola < MAX_COLA) { cola[enCola] = t; rssiCola[enCola] = rssi; enCola++; }
  else Serial.println("Cola llena: se pierde la trama más nueva");
}

void vaciarCola() {
  int i = 0;
  while (i < enCola) {
    if (subir(cola[i], rssiCola[i])) {
      for (int j = i; j < enCola - 1; j++) { cola[j] = cola[j + 1]; rssiCola[j] = rssiCola[j + 1]; }
      enCola--;
    } else return; // sin conexión: se intenta después
  }
}

void setup() {
  Serial.begin(115200);
  SPI.begin(LORA_SCK, LORA_MISO, LORA_MOSI, LORA_SS);
  LoRa.setPins(LORA_SS, LORA_RST, LORA_DIO0);
  if (!LoRa.begin(LORA_FREQ)) { Serial.println("No se encontró la radio LoRa"); while (true) delay(1000); }
  LoRa.setSyncWord(0x4E);       // misma red privada que los nodos
  LoRa.setSpreadingFactor(9);
  LoRa.setSignalBandwidth(125E3);
  LoRa.enableCrc();
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  Serial.println("Puerta de enlace NEXO escuchando en 915 MHz");
}

unsigned long ultimoIntento = 0;

void loop() {
  int tam = LoRa.parsePacket();
  if (tam) {
    String t = "";
    while (LoRa.available()) t += (char)LoRa.read();
    int rssi = LoRa.packetRssi();
    Serial.print("TRAMA|"); Serial.print(rssi); Serial.print("|"); Serial.println(t); // para lectura por puerto serie
    if (valida(t)) { encolar(t, rssi); vaciarCola(); }
    else Serial.println("Trama ignorada (formato no NEXO)");
  }
  if (enCola > 0 && millis() - ultimoIntento > 15000) {
    ultimoIntento = millis();
    if (WiFi.status() != WL_CONNECTED) WiFi.reconnect();
    vaciarCola();
  }
}
