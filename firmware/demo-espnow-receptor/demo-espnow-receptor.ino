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

const uint8_t CANAL_WIFI    = 1;      // ¡Debe coincidir exactamente con el ESP32 #1!
const int     LED_PIN       = 2;      // LED azul integrado en la placa
const int     LED_EXT_PIN   = 25;     // LED externo de alerta (con resistencia 220-330 ohm a GND)
const int     BUZZER_PIN    = 26;     // Buzzer (+ a GPIO 26, - a GND)
const bool    BUZZER_ACTIVO = false;  // false = buzzer PASIVO (recomendado), true = buzzer ACTIVO

uint8_t MAC_BROADCAST[6] = {0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF};

void fijarLed(bool encendido) {
  digitalWrite(LED_PIN, encendido ? HIGH : LOW);
  digitalWrite(LED_EXT_PIN, encendido ? HIGH : LOW);
}

void sonar(int freqHz, int duracionMs) {
  if (BUZZER_ACTIVO) {
    digitalWrite(BUZZER_PIN, HIGH);
    delay(duracionMs);
    digitalWrite(BUZZER_PIN, LOW);
  } else {
    tone(BUZZER_PIN, freqHz, duracionMs);
    delay(duracionMs);
    noTone(BUZZER_PIN);
  }
}

void alertaRecepcion() {
  // 3 pitidos claros de alerta + LED parpadeando y encendido 1.5 s al final
  for (int i = 0; i < 3; i++) {
    fijarLed(true);
    sonar(2200, 130);
    fijarLed(false);
    delay(80);
  }
  fijarLed(true);
}

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
unsigned long ledApagarEn  = 0;

void setup() {
  Serial.begin(115200);
  delay(300);
  pinMode(LED_PIN, OUTPUT);
  pinMode(LED_EXT_PIN, OUTPUT);
  pinMode(BUZZER_PIN, OUTPUT);
  fijarLed(false);
  digitalWrite(BUZZER_PIN, LOW);

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

  // Peer broadcast para devolver "ACK" de confirmación al ESP32 #1
  esp_now_peer_info_t peer = {};
  memcpy(peer.peer_addr, MAC_BROADCAST, 6);
  peer.channel = CANAL_WIFI;
  peer.ifidx   = WIFI_IF_STA;
  peer.encrypt = false;
  esp_now_add_peer(&peer);

  // Prueba rápida de arranque: LED + 1 pitido corto
  fijarLed(true);
  sonar(1800, 80);
  fijarLed(false);
  for (int i = 0; i < 2; i++) { fijarLed(true); delay(80); fijarLed(false); delay(80); }
  Serial.println("Escuchando reportes de albergues por ESP-NOW...");
}

void loop() {
  if (ledApagarEn > 0 && millis() >= ledApagarEn) {
    ledApagarEn = 0;
    fijarLed(false);
  }
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
      // 1. Devolver confirmación (ACK) inmediata al ESP32 #1
      esp_now_send(MAC_BROADCAST, (const uint8_t*)"ACK", 3);
      // 2. Pasar la trama por USB a NEXO
      Serial.print("TRAMA|");
      Serial.print(rssi);
      Serial.print("|");
      Serial.println(t);
      // 3. Alerta visual y sonora en Protección Civil
      alertaRecepcion();
      ledApagarEn = millis() + 2000;
    } else if (t != "ACK") {
      Serial.print("[Ignorado] ");
      Serial.println(t);
    }
  }
  delay(10);
}
