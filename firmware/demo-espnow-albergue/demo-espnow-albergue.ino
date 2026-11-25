// NEXO · ESP32 #1: Nodo Albergue / Escuela (Intranet + Portal Cautivo + ESP-NOW)
// Para demostración en vivo sin internet ni señal celular (solo ESP32 estándar).
//
// Qué hace:
//   1. Crea una red Wi-Fi local ("NEXO-Albergue") con portal cautivo automático.
//   2. Cualquier celular se conecta (incluso en modo avión + solo Wi-Fi) y llena un reporte.
//   3. Envía la trama compacta de NEXO al ESP32 #2 usando ESP-NOW en el MISMO canal Wi-Fi.
//
// Compatible con ESP32 Arduino Core 2.x y 3.x (no requiere librerías externas).

#include <Arduino.h>
#include <WiFi.h>
#include <WebServer.h>
#include <DNSServer.h>
#include <esp_now.h>
#include <esp_wifi.h>

// ---- Configuración (debe coincidir el CANAL_WIFI con el ESP32 #2) ----
const char*   AP_SSID    = "NEXO-Albergue";
const char*   AP_PASS    = "";   // red abierta para conexión rápida en la demo
const uint8_t CANAL_WIFI = 1;    // ¡Mismo canal que el receptor ESP-NOW!
const int     LED_PIN    = 2;

// Broadcast: llega a cualquier ESP32 #2 escuchando en CANAL_WIFI sin copiar MAC.
// Si prefieres fijar un receptor específico, cambia estos 6 bytes por la MAC del ESP32 #2.
uint8_t MAC_DESTINO[6] = {0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF};

DNSServer dnsServer;
WebServer server(80);
unsigned long reportesEnviados = 0;

void parpadear(int veces = 2) {
  for (int i = 0; i < veces; i++) {
    digitalWrite(LED_PIN, HIGH); delay(90);
    digitalWrite(LED_PIN, LOW);  delay(70);
  }
}

// Limpia caracteres que podrían romper la trama separada por "|"
String limpiar(String s, size_t maxLen) {
  s.trim();
  s.replace("|", " ");
  s.replace("\r", " ");
  s.replace("\n", " ");
  s.replace("\"", "'");
  if (s.length() > maxLen) s = s.substring(0, maxLen);
  return s;
}

bool enviarEspNow(const String& trama) {
  if (trama.length() == 0 || trama.length() > 240) return false;
  esp_err_t res = esp_now_send(MAC_DESTINO, (const uint8_t*)trama.c_str(), trama.length());
  Serial.print("[ESP-NOW] (");
  Serial.print(trama.length());
  Serial.print(" bytes) ");
  Serial.print(trama);
  Serial.println(res == ESP_OK ? " -> ENVIADO" : " -> ERROR");
  if (res == ESP_OK) {
    reportesEnviados++;
    parpadear(2);
    return true;
  }
  return false;
}

const char PAGINA_FORM[] PROGMEM = R"HTML(<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>NEXO · Reporte sin internet</title>
<style>
  *{box-sizing:border-box;font-family:system-ui,-apple-system,sans-serif}
  body{margin:0;background:#0f172a;color:#f8fafc;padding:16px}
  .card{max-width:460px;margin:0 auto;background:#1e293b;border-radius:14px;padding:18px;box-shadow:0 8px 24px rgba(0,0,0,.35)}
  h1{margin:0 0 4px;font-size:1.3rem;color:#38bdf8}
  .sub{margin:0 0 14px;font-size:.86rem;color:#cbd5e1}
  label{display:block;font-size:.85rem;margin:10px 0 4px;color:#e2e8f0;font-weight:600}
  input,select,textarea{width:100%;padding:10px;border-radius:8px;border:1px solid #475569;background:#0f172a;color:#fff;font-size:.95rem}
  .row{display:flex;gap:10px}.row>div{flex:1}
  .chips{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:6px}
  .chip{display:flex;align-items:center;gap:6px;background:#0f172a;border:1px solid #334155;padding:8px;border-radius:8px;font-size:.85rem;font-weight:400;margin:0}
  .chip input{width:auto;margin:0}
  button{width:100%;margin-top:16px;padding:13px;border:0;border-radius:10px;background:#0284c7;color:#fff;font-size:1rem;font-weight:700;cursor:pointer}
  button:active{background:#0369a1}
  .badge{display:inline-block;background:#065f46;color:#a7f3d0;padding:3px 8px;border-radius:99px;font-size:.75rem;margin-bottom:8px}
</style>
</head>
<body>
<div class="card">
  <span class="badge">Red local de emergencia · Sin internet</span>
  <h1>NEXO · Reporte rápido</h1>
  <p class="sub">Envía reportes de albergue, personas localizadas o daños directo a Protección Civil vía radio local.</p>
  <form method="POST" action="/enviar">
    <label>Tipo de reporte</label>
    <select name="tipo">
      <option value="R">Reporte de emergencia / daños / localizados</option>
      <option value="A">Actualización de albergue (cupo)</option>
    </select>

    <label>Escuela, albergue o punto</label>
    <input id="nombre" name="nombre" value="Esc. Primaria Juarez (Atlixco)" maxlength="40" required>

    <label>Ubicación del nodo / zona de Puebla</label>
    <select id="zona" onchange="fijarZona(this.value)">
      <optgroup label="Ubicación fija de este nodo (automática)">
        <option value="19.0412,-98.4123|Esc. Primaria Juarez (Atlixco)">Este nodo: Atlixco · Esc. Primaria Juárez</option>
      </optgroup>
      <optgroup label="Zona Popocatépetl (riesgo volcánico)">
        <option value="19.0717,-98.4858|San Nicolas de los Ranchos">San Nicolás de los Ranchos</option>
        <option value="19.0761,-98.5150|Santiago Xalitzintla">Santiago Xalitzintla</option>
        <option value="18.9522,-98.5458|San Pedro Benito Juarez">San Pedro Benito Juárez</option>
        <option value="18.8908,-98.5736|Tochimilco Centro">Tochimilco</option>
        <option value="19.1603,-98.4075|Huejotzingo Albergue">Huejotzingo</option>
      </optgroup>
      <optgroup label="Zona Metropolitana y Valles">
        <option value="19.0414,-98.2063|Puebla Centro">Puebla Centro</option>
        <option value="19.0630,-98.3060|San Pedro Cholula">San Pedro Cholula</option>
        <option value="19.0542,-98.2836|San Andres Cholula">San Andrés Cholula</option>
        <option value="19.2844,-98.4389|San Martin Texmelucan">San Martín Texmelucan</option>
        <option value="18.9088,-98.4321|Atlixco Centro">Atlixco Centro</option>
        <option value="19.0494,-98.1053|Amozoc Albergue">Amozoc</option>
      </optgroup>
      <optgroup label="Sierra Norte (lluvias y deslaves)">
        <option value="19.9333,-97.9619|Zacatlan Sierra Norte">Zacatlán</option>
        <option value="20.1739,-98.0547|Huauchinango Albergue">Huauchinango</option>
        <option value="19.8172,-97.3597|Teziutlan Albergue">Teziutlán</option>
        <option value="20.0178,-97.5222|Cuetzalan del Progreso">Cuetzalan del Progreso</option>
        <option value="19.8397,-98.0319|Chignahuapan">Chignahuapan</option>
        <option value="20.2756,-97.9608|Xicotepec de Juarez">Xicotepec de Juárez</option>
      </optgroup>
      <optgroup label="Sur, Mixteca y Valle de Serdán">
        <option value="18.4631,-97.3930|Tehuacan Albergue">Tehuacán</option>
        <option value="18.6022,-98.4650|Izucar de Matamoros">Izúcar de Matamoros</option>
        <option value="18.2028,-98.0489|Acatlan de Osorio">Acatlán de Osorio</option>
        <option value="18.9894,-97.4461|Ciudad Serdan">Ciudad Serdán (Chalchicomula)</option>
        <option value="18.8842,-97.7289|Tecamachalco">Tecamachalco</option>
      </optgroup>
    </select>
    <button type="button" onclick="intentarGPS()" style="margin-top:8px;padding:9px;background:#334155;font-size:.85rem">Detectar con GPS del celular (opcional)</button>
    <p id="gpsMsg" class="sub" style="margin:6px 0 0;font-size:.78rem">Si no sabes tus coordenadas, el nodo ya usa su ubicación fija o elige tu municipio arriba.</p>
    <div class="row">
      <div><label>Latitud</label><input id="lat" name="lat" value="19.0412" required></div>
      <div><label>Longitud</label><input id="lon" name="lon" value="-98.4123" required></div>
    </div>

    <div class="row">
      <div><label>Personas</label><input type="number" name="personas" value="12" min="0" max="50000" required></div>
      <div><label>Capacidad (opcional)</label><input type="number" name="capacidad" value="150" min="0" max="50000"></div>
    </div>

    <label>Insumos / necesidades urgentes</label>
    <div class="chips">
      <label class="chip"><input type="checkbox" name="n_ag" value="1" checked>Agua</label>
      <label class="chip"><input type="checkbox" name="n_al" value="1">Alimentos</label>
      <label class="chip"><input type="checkbox" name="n_me" value="1" checked>Medicinas</label>
      <label class="chip"><input type="checkbox" name="n_am" value="1">Atención médica</label>
      <label class="chip"><input type="checkbox" name="n_co" value="1">Cobijas</label>
      <label class="chip"><input type="checkbox" name="n_tr" value="1">Traslado</label>
      <label class="chip"><input type="checkbox" name="n_en" value="1">Energía</label>
      <label class="chip"><input type="checkbox" name="n_cm" value="1">Comunicación</label>
    </div>

    <label>Descripción breve (daños / personas localizadas)</label>
    <textarea name="nota" rows="2" maxlength="70" placeholder="Ej. 3 familias a salvo, techo dañado"></textarea>

    <button type="submit">Enviar a Protección Civil</button>
  </form>
</div>
<script>
function fijarZona(v){
  var partes=v.split('|');
  var c=partes[0].split(',');
  document.getElementById('lat').value=c[0];
  document.getElementById('lon').value=c[1];
  if(partes[1]) document.getElementById('nombre').value=partes[1];
}
function intentarGPS(){
  var msg=document.getElementById('gpsMsg');
  if(!navigator.geolocation){ msg.textContent='Tu navegador no permite GPS aquí; usa la ubicación fija del nodo o el menú.'; return; }
  msg.textContent='Intentando leer GPS...';
  navigator.geolocation.getCurrentPosition(
    function(pos){
      document.getElementById('lat').value=pos.coords.latitude.toFixed(4);
      document.getElementById('lon').value=pos.coords.longitude.toFixed(4);
      msg.textContent='GPS detectado automáticamente ('+pos.coords.latitude.toFixed(4)+', '+pos.coords.longitude.toFixed(4)+').';
    },
    function(){
      msg.textContent='El navegador bloquea el GPS en portales locales sin HTTPS. No pasa nada: en campo cada nodo ESP32 ya tiene su ubicación fija grabada (o elige tu zona arriba).';
    },
    {timeout:6000}
  );
}
</script>
</body>
</html>)HTML";

void mostrarFormulario() {
  server.send(200, "text/html; charset=utf-8", PAGINA_FORM);
}

void manejarEnvio() {
  String tipo = server.arg("tipo");
  if (tipo != "A" && tipo != "R" && tipo != "B") tipo = "R";
  String nombre    = limpiar(server.arg("nombre"), 40);
  if (nombre.length() == 0) nombre = "Punto sin nombre";
  String personas  = limpiar(server.arg("personas"), 8);
  if (personas.length() == 0) personas = "0";
  String capacidad = (tipo == "A") ? limpiar(server.arg("capacidad"), 8) : "";
  String lat       = limpiar(server.arg("lat"), 12);
  String lon       = limpiar(server.arg("lon"), 12);
  String nota      = limpiar(server.arg("nota"), 70);

  const char* codigos[] = {"ag", "al", "me", "am", "co", "tr", "en", "cm"};
  String nec = "";
  for (int i = 0; i < 8; i++) {
    if (server.hasArg(String("n_") + codigos[i])) {
      if (nec.length() > 0) nec += ",";
      nec += codigos[i];
    }
  }

  String trama = tipo + "|" + nombre + "|" + personas + "|" + capacidad + "|" + lat + "|" + lon + "|" + nec;
  if (nota.length() > 0) trama += "|" + nota;
  if (trama.length() > 235) trama = trama.substring(0, 235);

  bool ok = enviarEspNow(trama);

  String html = F("<!doctype html><html lang='es'><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'>"
                  "<title>NEXO · Enviado</title><style>body{font-family:system-ui,sans-serif;background:#0f172a;color:#f8fafc;padding:20px}"
                  ".box{max-width:440px;margin:20px auto;background:#1e293b;padding:20px;border-radius:14px}"
                  "code{display:block;background:#0f172a;padding:10px;border-radius:8px;word-break:break-all;font-size:.82rem;color:#7dd3fc}"
                  "a{display:block;text-align:center;margin-top:16px;padding:12px;background:#0284c7;color:#fff;text-decoration:none;border-radius:10px;font-weight:700}</style></head><body><div class='box'>");
  html += ok ? F("<h2 style='color:#4ade80;margin-top:0'>Reporte enviado sin internet</h2>")
             : F("<h2 style='color:#f87171;margin-top:0'>No se pudo transmitir por ESP-NOW</h2>");
  html += F("<p>Trama compacta enviada (");
  html += String(trama.length());
  html += F(" bytes):</p><code>");
  html += trama;
  html += F("</code><p style='font-size:.85rem;color:#cbd5e1'>Total enviados desde este nodo: ");
  html += String(reportesEnviados);
  html += F("</p><a href='/'>Enviar otro reporte</a></div></body></html>");
  server.send(200, "text/html; charset=utf-8", html);
}

void redirigirPortal() {
  server.sendHeader("Location", String("http://") + WiFi.softAPIP().toString() + "/", true);
  server.send(302, "text/plain", "");
}

void setup() {
  Serial.begin(115200);
  pinMode(LED_PIN, OUTPUT);
  digitalWrite(LED_PIN, LOW);

  // 1. Iniciar Wi-Fi en modo AP+STA sin ahorro de energía y bloquear el canal exacto
  WiFi.persistent(false);
  WiFi.mode(WIFI_AP_STA);
  WiFi.setSleep(false);
  WiFi.softAP(AP_SSID, strlen(AP_PASS) ? AP_PASS : nullptr, CANAL_WIFI, 0, 8);
  delay(150);
  esp_wifi_set_ps(WIFI_PS_NONE);
  esp_wifi_set_channel(CANAL_WIFI, WIFI_SECOND_CHAN_NONE);

  uint8_t chReal = 0; wifi_second_chan_t ch2;
  esp_wifi_get_channel(&chReal, &ch2);

  Serial.println();
  Serial.println("=== NEXO · ESP32 #1 (Albergue + Portal Cautivo + ESP-NOW) ===");
  Serial.print("Red Wi-Fi: "); Serial.print(AP_SSID);
  Serial.print(" | Canal real: "); Serial.println(chReal);
  Serial.print("IP Portal: http://"); Serial.println(WiFi.softAPIP());
  Serial.print("MAC AP:    "); Serial.println(WiFi.softAPmacAddress());

  // 2. Iniciar ESP-NOW usando la interfaz AP activa en el mismo canal
  if (esp_now_init() != ESP_OK) {
    Serial.println("ERROR: no se pudo iniciar ESP-NOW");
  } else {
    esp_now_peer_info_t peer = {};
    memcpy(peer.peer_addr, MAC_DESTINO, 6);
    peer.channel = CANAL_WIFI;
    peer.ifidx   = WIFI_IF_AP;
    peer.encrypt = false;
    esp_err_t r = esp_now_add_peer(&peer);
    if (r != ESP_OK) {
      peer.channel = 0;
      peer.ifidx   = WIFI_IF_STA;
      r = esp_now_add_peer(&peer);
    }
    Serial.println(r == ESP_OK ? "ESP-NOW listo en canal " + String(chReal)
                               : "ERROR agregando peer ESP-NOW: " + String((int)r));
  }

  // 3. Portal cautivo: redirige cualquier consulta DNS y URL de prueba al formulario
  dnsServer.start(53, "*", WiFi.softAPIP());
  server.on("/", HTTP_GET, mostrarFormulario);
  server.on("/enviar", HTTP_POST, manejarEnvio);
  server.on("/generate_204", redirigirPortal);
  server.on("/gen_204", redirigirPortal);
  server.on("/hotspot-detect.html", redirigirPortal);
  server.on("/connecttest.txt", redirigirPortal);
  server.on("/ncsi.txt", redirigirPortal);
  server.on("/fwlink", redirigirPortal);
  server.onNotFound(redirigirPortal);
  server.begin();

  parpadear(3);
  Serial.println("Listo. Conecta tu celular al Wi-Fi 'NEXO-Albergue'.");
}

void loop() {
  dnsServer.processNextRequest();
  server.handleClient();
}
