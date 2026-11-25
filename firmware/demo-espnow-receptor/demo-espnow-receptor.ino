// NEXO · ESP32 #2: Receptor Protección Civil (ESP-NOW -> USB Serial -> NEXO)
// Para demostración en vivo conectado por cable USB a tu laptop.
//
// Qué hace:
//   1. Escucha paquetes ESP-NOW en el MISMO CANAL_WIFI que el ESP32 #1.
//   2. Imprime cada trama recibida por USB Serial con el formato:
//        TRAMA|<rssi>|<trama_nexo>
//   3. En tu laptop, ejecuta `npm run puente:usb` para enviarlo en vivo a NEXO.
//
// Compatible con ESP32 Arduino Core 2.x y 3.x (no requiere librerías externas).

#include <Arduino.h>
#include <WiFi.h>
#include <esp_now.h>
#include <esp_wifi.h>

const uint8_t CANAL_WIFI = 1;  // ¡Debe coincidir exactamente con el ESP32 #1!
const int     LED_PIN    = 2;

// Cola circular segura para sacar la impresión del callback de Wi-Fi hacia loop()
const int MAX_COLA = 8;
const int MAX_BYTES = 245;

struct Mensaje {
  char texto[MAX_BYTES];
  int  rssi;
};

Mensaje cola[MAX_COLA];
volatile int cabeza = 0;
volatile int colaIdx = 0;

void encolarMensaje(const uint8_t* data, int len, int rssi) {
  int sig = (cabeza + 1) % MAX_COLA;
  if (sig == colaIdx) return; // cola llena
  int n = len < (MAX_BYTES - 1) ? len : (MAX_BYTES - 1);
  memcpy(cola[cabeza].texto, data, n);
  cola[cabeza].texto[n] = '\0';
  cola[cabeza].rssi = rssi;
  cabeza = sig;
}

#if defined(ESP_ARDUINO_VERSION) && ESP_ARDUINO_VERSION >= ESP_ARDUINO_VERSION_VAL(3, 0, 0)
void alRecibir(const esp_now_recv_info_t* info, const uint8_t* data, int len) {
  int rssi = (info && info->rx_ctrl) ? info->rx_ctrl->rssi : -50;
  encolarMensaje(data, len, rssi);
}
#else
void alRecibir(const uint8_t* mac, const uint8_t* data, int len) {
  (void)mac;
  encolarMensaje(data, len, -50);
}
#endif

bool tramaValida(const String& t) {
  return t.length() > 8 && t.length() <= 240 && (t.startsWith("A|") || t.startsWith("R|") || t.startsWith("B|"));
}

unsigned long ultimoLatido = 0;

void setup() {
  Serial.begin(115200);
  delay(300);
  pinMode(LED_PIN, OUTPUT);
  digitalWrite(LED_PIN, LOW);

  // Modo estación sin ahorro de energía y bloqueado exactamente en CANAL_WIFI
  WiFi.persistent(false);
  WiFi.setAutoReconnect(false);
  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);
  delay(150);
  esp_wifi_set_ps(WIFI_PS_NONE);
  esp_wifi_set_promiscuous(true);
  esp_wifi_set_channel(CANAL_WIFI, WIFI_SECOND_CHAN_NONE);
  esp_wifi_set_promiscuous(false);

  uint8_t chReal = 0; wifi_second_chan_t ch2;
  esp_wifi_get_channel(&chReal, &ch2);

  Serial.println();
  Serial.println("=== NEXO · ESP32 #2 (Receptor ESP-NOW -> USB) ===");
  Serial.print("Canal real:   "); Serial.println(chReal);
  Serial.print("MAC Receptor: "); Serial.println(WiFi.macAddress());

  if (esp_now_init() != ESP_OK) {
    Serial.println("ERROR: no se pudo iniciar ESP-NOW");
    while (true) delay(1000);
  }
  esp_now_register_recv_cb(alRecibir);
  for (int i = 0; i < 3; i++) { digitalWrite(LED_PIN, HIGH); delay(80); digitalWrite(LED_PIN, LOW); delay(80); }
  Serial.println("Escuchando reportes de albergues por ESP-NOW...");
}

void loop() {
  if (millis() - ultimoLatido > 8000) {
    ultimoLatido = millis();
    uint8_t chReal = 0; wifi_second_chan_t ch2;
    esp_wifi_get_channel(&chReal, &ch2);
    Serial.print("LISTO | Canal "); Serial.print(chReal); Serial.println(" | Esperando reportes ESP-NOW...");
  }
  while (colaIdx != cabeza) {
    String t = String(cola[colaIdx].texto);
    int rssi = cola[colaIdx].rssi;
    colaIdx = (colaIdx + 1) % MAX_COLA;
    t.trim();

    if (tramaValida(t)) {
      digitalWrite(LED_PIN, HIGH);
      Serial.print("TRAMA|");
      Serial.print(rssi);
      Serial.print("|");
      Serial.println(t);
      delay(80);
      digitalWrite(LED_PIN, LOW);
    } else {
      Serial.print("[Ignorado] ");
      Serial.println(t);
    }
  }
  delay(10);
}
