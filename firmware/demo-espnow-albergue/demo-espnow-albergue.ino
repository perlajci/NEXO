// PIANI · ESP32 #1: Nodo Albergue / Escuela (Intranet + Portal Cautivo + ESP-NOW)
// Para demostración en vivo sin internet ni señal celular (solo ESP32 estándar).
//
// Qué hace:
//   1. Crea la red Wi-Fi local ("PIANI-Albergue") con portal cautivo oficial PIANI.
//   2. Incluye acceso tipo login (Ciudadano o Brigadista con clave), logo PIANI offline
//      y validaciones completas en formulario y servidor.
//   3. Envía la trama compacta al ESP32 #2 por ESP-NOW (canal 1) y espera confirmación ACK
//      con aviso visual y sonoro (LED GPIO 25 + Buzzer GPIO 26).
//
// Compatible con ESP32 Arduino Core 2.x y 3.x (no requiere librerías externas).

#include <Arduino.h>
#include <WiFi.h>
#include <WebServer.h>
#include <DNSServer.h>
#include <esp_now.h>
#include <esp_wifi.h>
#include "piani_logo.h"

// ---- Configuración (debe coincidir CANAL_WIFI con el ESP32 #2) ----
const char*   AP_SSID       = "PIANI-Albergue";
const char*   AP_PASS       = "";           // red abierta para conexión rápida en la demo
const char*   CLAVE_BRIGADA = "PIANI2026";  // clave de acceso para Brigadistas / Albergues
const uint8_t CANAL_WIFI    = 1;            // ¡Mismo canal que el receptor ESP-NOW!
const int     LED_PIN       = 2;            // LED azul integrado en la placa
const int     LED_EXT_PIN   = 25;           // LED externo (con resistencia 220-330 ohm a GND)
const int     BUZZER_PIN    = 26;           // Buzzer (+ a GPIO 26, - a GND)
const bool    BUZZER_ACTIVO = false;        // false = buzzer PASIVO, true = buzzer ACTIVO

// Broadcast: llega a cualquier ESP32 #2 escuchando en CANAL_WIFI sin copiar MAC.
uint8_t MAC_DESTINO[6] = {0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF};

DNSServer dnsServer;
WebServer server(80);
unsigned long reportesEnviados = 0;
volatile bool ackRecibido = false;
unsigned long ledApagarEn = 0;

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

void parpadear(int veces = 2) {
  for (int i = 0; i < veces; i++) {
    fijarLed(true);  delay(90);
    fijarLed(false); delay(70);
  }
}

void sonidoConfirmado() {
  fijarLed(true);
  sonar(1500, 110);
  delay(60);
  sonar(2100, 180);
  ledApagarEn = millis() + 2000;
}

void sonidoSinConfirmacion() {
  fijarLed(true);
  sonar(450, 320);
  fijarLed(false);
}

#if defined(ESP_ARDUINO_VERSION) && ESP_ARDUINO_VERSION >= ESP_ARDUINO_VERSION_VAL(3, 0, 0)
void alRecibirAck(const esp_now_recv_info_t* info, const uint8_t* data, int len) {
  (void)info;
  if (len >= 3 && data[0] == 'A' && data[1] == 'C' && data[2] == 'K') ackRecibido = true;
}
#else
void alRecibirAck(const uint8_t* mac, const uint8_t* data, int len) {
  (void)mac;
  if (len >= 3 && data[0] == 'A' && data[1] == 'C' && data[2] == 'K') ackRecibido = true;
}
#endif

// Limpia caracteres que podrían romper la trama separada por "|" o el HTML
String limpiar(String s, size_t maxLen) {
  s.trim();
  s.replace("|", " ");
  s.replace("\r", " ");
  s.replace("\n", " ");
  s.replace("\"", "'");
  s.replace("<", "");
  s.replace(">", "");
  if (s.length() > maxLen) s = s.substring(0, maxLen);
  return s;
}

bool claveValida(String clave) {
  clave.trim();
  return clave.equalsIgnoreCase(CLAVE_BRIGADA);
}

// Devuelve: 0 = error de envío, 1 = enviado sin ACK, 2 = enviado y CONFIRMADO por el receptor
int enviarEspNow(const String& trama) {
  if (trama.length() == 0 || trama.length() > 240) return 0;
  ackRecibido = false;
  fijarLed(true);
  esp_err_t res = esp_now_send(MAC_DESTINO, (const uint8_t*)trama.c_str(), trama.length());
  Serial.print("[ESP-NOW] (");
  Serial.print(trama.length());
  Serial.print(" bytes) ");
  Serial.print(trama);
  if (res != ESP_OK) {
    Serial.println(" -> ERROR");
    sonidoSinConfirmacion();
    return 0;
  }
  reportesEnviados++;
  sonar(1200, 80); // 1 pitido corto: reporte emitido
  unsigned long inicio = millis();
  while (!ackRecibido && millis() - inicio < 700) delay(10);

  if (ackRecibido) {
    Serial.println(" -> ENVIADO Y CONFIRMADO (ACK)");
    sonidoConfirmado();
    return 2;
  } else {
    Serial.println(" -> ENVIADO (sin ACK del receptor)");
    sonidoSinConfirmacion();
    return 1;
  }
}

const char PAGINA_APP[] PROGMEM = R"HTML(<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>PIANI · Red Local de Emergencia</title>
<style>
  :root{
    --marino:#0b2a55;--turquesa:#19c3cf;--accent:#0a7d89;--accentSoft:#e6f6f7;
    --bg:#eef3f7;--panel:#ffffff;--panel2:#f6f9fc;--line:#d5e0ea;--muted:#52647a;
    --ok:#1f7a4c;--okSoft:#e8f7ef;--warn:#9a5b00;--warnSoft:#fff6e5;--err:#b8222b;--errSoft:#fdeeee;
  }
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--marino);font:15px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
  .barra{background:#fff;border-bottom:3px solid var(--turquesa);padding:12px 16px;display:flex;align-items:center;justify-content:space-between;gap:12px;box-shadow:0 1px 4px rgba(11,42,85,.06)}
  .marca{display:flex;align-items:center;gap:10px}
  .marca img{height:44px;width:auto;display:block}
  .marca .txt b{display:block;font-size:15px;letter-spacing:.01em;color:var(--marino)}
  .marca .txt small{display:block;font-size:11.5px;color:var(--muted)}
  .estado{display:inline-flex;align-items:center;gap:6px;font-size:11.5px;font-weight:700;padding:5px 10px;border-radius:99px;background:var(--okSoft);color:var(--ok);white-space:nowrap}
  .estado::before{content:"";width:7px;height:7px;border-radius:50%;background:var(--ok)}
  .wrap{max-width:480px;margin:16px auto 32px;padding:0 14px}
  .card{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:20px;box-shadow:0 4px 16px rgba(11,42,85,.06)}
  .hero-logo{text-align:center;margin-bottom:14px}
  .hero-logo img{height:76px;width:auto}
  h1{margin:0 0 4px;font-size:20px;font-weight:800;color:var(--marino)}
  .sub{margin:0 0 14px;font-size:13.5px;color:var(--muted)}
  .tabs{display:grid;grid-template-columns:1fr 1fr;gap:6px;background:var(--panel2);padding:4px;border-radius:10px;border:1px solid var(--line);margin-bottom:14px}
  .tab{border:0;background:transparent;color:var(--muted);padding:9px 8px;border-radius:8px;font-size:13.5px;font-weight:700;cursor:pointer;transition:background .15s,color .15s}
  .tab.activo{background:var(--marino);color:#fff}
  .campo{margin-bottom:13px}
  label.lbl{display:block;font-size:13px;font-weight:700;margin-bottom:5px;color:var(--marino)}
  input[type=text],input[type=password],input[type=number],select,textarea{
    width:100%;padding:11px 12px;border-radius:9px;border:1.5px solid #cbd7e3;background:#fff;
    color:var(--marino);font:inherit;font-size:16px;outline:none;transition:border-color .15s,box-shadow .15s
  }
  input:focus,select:focus,textarea:focus{border-color:var(--accent);box-shadow:0 0 0 3px rgba(25,195,207,.22)}
  .invalido{border-color:var(--err)!important;background:#fffafa!important}
  .err{display:none;color:var(--err);font-size:12.5px;font-weight:600;margin-top:4px}
  .err.ver{display:block}
  .alerta-form{display:none;background:var(--errSoft);border:1px solid #f2b8bc;color:var(--err);padding:10px 12px;border-radius:9px;font-size:13px;font-weight:600;margin-bottom:12px}
  .alerta-form.ver{display:block}
  .fila{display:grid;grid-template-columns:1fr 1fr;gap:10px}
  .sesion{display:flex;align-items:center;justify-content:space-between;gap:8px;background:var(--panel2);border:1px solid var(--line);border-left:4px solid var(--accent);border-radius:10px;padding:9px 12px;margin-bottom:14px;font-size:13px}
  .sesion b{color:var(--marino)}
  .btn-salir{border:1px solid var(--line);background:#fff;color:var(--marino);padding:5px 10px;border-radius:7px;font-size:12px;font-weight:700;cursor:pointer}
  .chips{display:grid;grid-template-columns:1fr 1fr;gap:8px}
  .chip{display:flex;align-items:center;gap:8px;padding:9px 10px;border:1.5px solid var(--line);border-radius:9px;background:var(--panel2);font-size:13.5px;font-weight:600;cursor:pointer;user-select:none}
  .chip input{width:18px;height:18px;accent-color:var(--accent);margin:0;flex:none}
  .chip:has(input:checked){background:var(--accentSoft);border-color:var(--accent);color:var(--marino)}
  .btn-pri{width:100%;padding:13px 16px;border:0;border-radius:10px;background:var(--marino);color:#fff;font-size:15.5px;font-weight:700;cursor:pointer;margin-top:6px}
  .btn-pri:active{background:#071d3d}
  .btn-sec{width:100%;padding:9px 12px;border:1.5px solid var(--line);border-radius:9px;background:var(--panel2);color:var(--marino);font-size:13px;font-weight:700;cursor:pointer;margin-top:6px}
  .ayuda{font-size:12px;color:var(--muted);margin:5px 0 0}
  .pie{text-align:center;font-size:12px;color:var(--muted);margin-top:14px}
  .oculto{display:none!important}
</style>
</head>
<body>
<header class="barra">
  <div class="marca">
    <img src="/logo.jpg" alt="PIANI">
    <div class="txt">
      <b>PIANI · Puebla</b>
      <small>Red local de emergencia</small>
    </div>
  </div>
  <span class="estado">Sin internet</span>
</header>

<main class="wrap">
  <!-- PASO 1: ACCESO / LOGIN -->
  <section id="vistaLogin" class="card">
    <div class="hero-logo"><img src="/logo.jpg" alt="Logo PIANI"></div>
    <h1 style="text-align:center">Acceso al punto de reporte</h1>
    <p class="sub" style="text-align:center">Identifícate para enviar un reporte directo a Protección Civil sin usar datos móviles.</p>

    <div class="tabs" role="tablist">
      <button type="button" id="tabCiudadano" class="tab activo" onclick="elegirRol('ciudadano')">Ciudadano</button>
      <button type="button" id="tabBrigada" class="tab" onclick="elegirRol('brigada')">Brigadista / Albergue</button>
    </div>

    <div id="errLoginGeneral" class="alerta-form"></div>

    <form id="formLogin" novalidate>
      <div class="campo">
        <label class="lbl" for="loginNombre">Tu nombre completo</label>
        <input id="loginNombre" type="text" maxlength="35" placeholder="Ej. María López" autocomplete="name" required>
        <div id="errLoginNombre" class="err">Escribe tu nombre (mínimo 3 letras).</div>
      </div>

      <div id="boxClave" class="campo oculto">
        <label class="lbl" for="loginClave">Clave de brigada o albergue</label>
        <input id="loginClave" type="password" maxlength="20" placeholder="Ingresa la clave operativa">
        <div id="errLoginClave" class="err">Clave incorrecta. Solicítala al coordinador del albergue.</div>
        <p class="ayuda">Habilita la actualización oficial de cupo de albergues.</p>
      </div>

      <button type="submit" class="btn-pri">Continuar al reporte</button>
    </form>
  </section>

  <!-- PASO 2: FORMULARIO DE REPORTE -->
  <section id="vistaReporte" class="card oculto">
    <div class="sesion">
      <span><b id="txtUsuario">Usuario</b> · <span id="txtRol">Ciudadano</span></span>
      <button type="button" class="btn-salir" onclick="cerrarSesion()">Cambiar</button>
    </div>

    <h1>Enviar reporte de emergencia</h1>
    <p class="sub">Los datos se transmiten por radio local al centro de mando PIANI.</p>

    <div id="errRepGeneral" class="alerta-form"></div>

    <form id="formReporte" method="POST" action="/enviar" novalidate>
      <input type="hidden" id="hRol" name="rol" value="ciudadano">
      <input type="hidden" id="hUsuario" name="usuario" value="">
      <input type="hidden" id="hClave" name="clave" value="">

      <div class="campo">
        <label class="lbl" for="tipo">Tipo de registro</label>
        <select id="tipo" name="tipo" onchange="actualizarTipo()">
          <option value="R">Reporte de emergencia / daños / personas localizadas</option>
          <option id="opAlbergue" value="A">Actualización de albergue (cupo oficial)</option>
        </select>
      </div>

      <div class="campo">
        <label class="lbl" for="zona">Ubicación del nodo / municipio de Puebla</label>
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
        <button type="button" class="btn-sec" onclick="intentarGPS()">Detectar ubicación con GPS (opcional)</button>
        <p id="gpsMsg" class="ayuda">Si no conoces tus coordenadas, el nodo ya tiene su ubicación fija o elige el municipio arriba.</p>
      </div>

      <div class="campo">
        <label class="lbl" for="nombre">Nombre de la escuela, albergue o punto</label>
        <input id="nombre" type="text" name="nombre" value="Esc. Primaria Juarez (Atlixco)" maxlength="40" required>
        <div id="errNombre" class="err">Indica un nombre de al menos 3 caracteres.</div>
      </div>

      <div class="fila">
        <div class="campo">
          <label class="lbl" for="lat">Latitud</label>
          <input id="lat" type="text" inputmode="decimal" name="lat" value="19.0412" required>
          <div id="errLat" class="err">Latitud fuera de Puebla (17.5 a 21.0).</div>
        </div>
        <div class="campo">
          <label class="lbl" for="lon">Longitud</label>
          <input id="lon" type="text" inputmode="decimal" name="lon" value="-98.4123" required>
          <div id="errLon" class="err">Longitud fuera de Puebla (-99.5 a -96.5).</div>
        </div>
      </div>

      <div class="fila">
        <div class="campo">
          <label class="lbl" for="personas">Personas en el punto</label>
          <input id="personas" type="number" name="personas" value="12" min="0" max="50000" required>
          <div id="errPersonas" class="err">Ingresa un número válido (0 a 50,000).</div>
        </div>
        <div class="campo" id="boxCapacidad">
          <label class="lbl" for="capacidad">Capacidad del albergue</label>
          <input id="capacidad" type="number" name="capacidad" value="150" min="1" max="50000">
          <div id="errCapacidad" class="err">Ingresa una capacidad mayor a 0.</div>
        </div>
      </div>

      <div class="campo">
        <label class="lbl">Insumos y necesidades urgentes</label>
        <div class="chips" id="grupoNec">
          <label class="chip"><input type="checkbox" name="n_ag" value="1">Agua</label>
          <label class="chip"><input type="checkbox" name="n_al" value="1">Alimentos</label>
          <label class="chip"><input type="checkbox" name="n_me" value="1">Medicinas</label>
          <label class="chip"><input type="checkbox" name="n_am" value="1">Atención médica</label>
          <label class="chip"><input type="checkbox" name="n_co" value="1">Cobijas</label>
          <label class="chip"><input type="checkbox" name="n_tr" value="1">Traslado</label>
          <label class="chip"><input type="checkbox" name="n_en" value="1">Energía</label>
          <label class="chip"><input type="checkbox" name="n_cm" value="1">Comunicación</label>
        </div>
      </div>

      <div class="campo">
        <label class="lbl" for="nota">Descripción breve (daños o personas localizadas)</label>
        <textarea id="nota" name="nota" rows="2" maxlength="55" placeholder="Ej. 3 familias a salvo, acceso bloqueado"></textarea>
        <div id="errDetalle" class="err">Marca al menos una necesidad urgente o escribe una descripción breve.</div>
      </div>

      <button type="submit" class="btn-pri" id="btnEnviar">Enviar reporte a Protección Civil</button>
    </form>
  </section>

  <p class="pie">PIANI · Protección Civil Puebla · Comunicación de emergencia sin internet</p>
</main>

<script>
var rolActual = 'ciudadano';
function elegirRol(rol){
  rolActual = rol;
  document.getElementById('tabCiudadano').classList.toggle('activo', rol === 'ciudadano');
  document.getElementById('tabBrigada').classList.toggle('activo', rol === 'brigada');
  document.getElementById('boxClave').classList.toggle('oculto', rol !== 'brigada');
  document.getElementById('errLoginClave').classList.remove('ver');
  document.getElementById('errLoginGeneral').classList.remove('ver');
}

function mostrarError(idInput, idErr, hayError){
  var el = document.getElementById(idInput);
  if(el) el.classList.toggle('invalido', hayError);
  var er = document.getElementById(idErr);
  if(er) er.classList.toggle('ver', hayError);
}

function abrirFormulario(nombre, rol, clave){
  document.getElementById('hUsuario').value = nombre;
  document.getElementById('hRol').value = rol;
  document.getElementById('hClave').value = clave || '';
  document.getElementById('txtUsuario').textContent = nombre;
  document.getElementById('txtRol').textContent = rol === 'brigada' ? 'Brigadista / Albergue' : 'Ciudadano';
  var opAlb = document.getElementById('opAlbergue');
  opAlb.disabled = (rol !== 'brigada');
  if(rol !== 'brigada') document.getElementById('tipo').value = 'R';
  actualizarTipo();
  document.getElementById('vistaLogin').classList.add('oculto');
  document.getElementById('vistaReporte').classList.remove('oculto');
}

function cerrarSesion(){
  try { sessionStorage.removeItem('piani_usr'); } catch(e){}
  document.getElementById('vistaReporte').classList.add('oculto');
  document.getElementById('vistaLogin').classList.remove('oculto');
}

function actualizarTipo(){
  var esAlb = document.getElementById('tipo').value === 'A';
  document.getElementById('boxCapacidad').classList.toggle('oculto', !esAlb);
}

document.getElementById('formLogin').addEventListener('submit', function(ev){
  ev.preventDefault();
  var nom = document.getElementById('loginNombre').value.trim();
  var clave = document.getElementById('loginClave').value.trim();
  var malNom = nom.length < 3;
  mostrarError('loginNombre', 'errLoginNombre', malNom);
  if(malNom) return;

  if(rolActual === 'brigada'){
    fetch('/validar?clave=' + encodeURIComponent(clave)).then(function(r){ return r.text(); }).then(function(txt){
      if(txt !== 'OK'){
        mostrarError('loginClave', 'errLoginClave', true);
        return;
      }
      mostrarError('loginClave', 'errLoginClave', false);
      try { sessionStorage.setItem('piani_usr', JSON.stringify({n:nom, r:'brigada', c:clave})); } catch(e){}
      abrirFormulario(nom, 'brigada', clave);
    }).catch(function(){
      var g = document.getElementById('errLoginGeneral');
      g.textContent = 'No se pudo validar con el nodo local. Intenta de nuevo.';
      g.classList.add('ver');
    });
  } else {
    try { sessionStorage.setItem('piani_usr', JSON.stringify({n:nom, r:'ciudadano', c:''})); } catch(e){}
    abrirFormulario(nom, 'ciudadano', '');
  }
});

document.getElementById('formReporte').addEventListener('submit', function(ev){
  var ok = true;
  var nom = document.getElementById('nombre').value.trim();
  var lat = parseFloat(document.getElementById('lat').value);
  var lon = parseFloat(document.getElementById('lon').value);
  var pers = parseInt(document.getElementById('personas').value, 10);
  var esAlb = document.getElementById('tipo').value === 'A';
  var cap = parseInt(document.getElementById('capacidad').value, 10);
  var nota = document.getElementById('nota').value.trim();
  var checks = document.querySelectorAll('#grupoNec input:checked').length;

  var eNom = nom.length < 3;
  var eLat = isNaN(lat) || lat < 17.5 || lat > 21.0;
  var eLon = isNaN(lon) || lon < -99.5 || lon > -96.5;
  var ePer = isNaN(pers) || pers < 0 || pers > 50000;
  var eCap = esAlb && (isNaN(cap) || cap < 1 || cap > 50000);
  var eDet = checks === 0 && nota.length < 4;

  mostrarError('nombre', 'errNombre', eNom);
  mostrarError('lat', 'errLat', eLat);
  mostrarError('lon', 'errLon', eLon);
  mostrarError('personas', 'errPersonas', ePer);
  mostrarError('capacidad', 'errCapacidad', eCap);
  mostrarError('nota', 'errDetalle', eDet);

  if(eNom || eLat || eLon || ePer || eCap || eDet) ok = false;
  var gen = document.getElementById('errRepGeneral');
  if(!ok){
    ev.preventDefault();
    gen.textContent = 'Revisa los campos marcados en rojo antes de enviar.';
    gen.classList.add('ver');
    window.scrollTo(0, 0);
  } else {
    gen.classList.remove('ver');
    var b = document.getElementById('btnEnviar');
    b.disabled = true;
    b.textContent = 'Transmitiendo por radio local...';
  }
});

function fijarZona(v){
  var partes = v.split('|');
  var c = partes[0].split(',');
  document.getElementById('lat').value = c[0];
  document.getElementById('lon').value = c[1];
  if(partes[1]) document.getElementById('nombre').value = partes[1];
  mostrarError('lat', 'errLat', false);
  mostrarError('lon', 'errLon', false);
}

function intentarGPS(){
  var msg = document.getElementById('gpsMsg');
  if(!navigator.geolocation){ msg.textContent = 'Tu navegador no permite GPS aquí; usa la ubicación fija del nodo o el menú.'; return; }
  msg.textContent = 'Intentando leer GPS...';
  navigator.geolocation.getCurrentPosition(
    function(pos){
      document.getElementById('lat').value = pos.coords.latitude.toFixed(4);
      document.getElementById('lon').value = pos.coords.longitude.toFixed(4);
      msg.textContent = 'GPS detectado (' + pos.coords.latitude.toFixed(4) + ', ' + pos.coords.longitude.toFixed(4) + ').';
    },
    function(){
      msg.textContent = 'El navegador bloquea el GPS sin HTTPS. No pasa nada: cada nodo fijo ya trae su ubicación grabada (o elige tu municipio arriba).';
    },
    {timeout:6000}
  );
}

// Restaura sesión activa si el usuario regresa para enviar otro reporte
(function(){
  try {
    var s = JSON.parse(sessionStorage.getItem('piani_usr') || 'null');
    if(s && s.n && s.n.length >= 3){ abrirFormulario(s.n, s.r, s.c); }
  } catch(e){}
})();
</script>
</body>
</html>)HTML";

void servirLogo() {
  server.sendHeader("Cache-Control", "public, max-age=3600");
  server.send_P(200, "image/jpeg", (const char*)PIANI_LOGO_JPG, PIANI_LOGO_LEN);
}

void mostrarApp() {
  server.send_P(200, "text/html; charset=utf-8", PAGINA_APP);
}

void validarClave() {
  server.send(200, "text/plain", claveValida(server.arg("clave")) ? "OK" : "NO");
}

void enviarPaginaResultado(const String& titulo, const String& colorTit, const String& detalle, const String& resumen, const String& trama) {
  String html = F("<!doctype html><html lang='es'><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'>"
                  "<title>PIANI · Confirmación</title><style>"
                  "*{box-sizing:border-box}body{margin:0;background:#eef3f7;color:#0b2a55;font:15px/1.45 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif}"
                  ".barra{background:#fff;border-bottom:3px solid #19c3cf;padding:12px 16px;display:flex;align-items:center;gap:10px}"
                  ".barra img{height:40px}.wrap{max-width:480px;margin:20px auto;padding:0 14px}"
                  ".card{background:#fff;border:1px solid #d5e0ea;border-radius:14px;padding:22px;box-shadow:0 4px 16px rgba(11,42,85,.06)}"
                  "h1{margin:0 0 8px;font-size:20px}.res{background:#f6f9fc;border:1px solid #d5e0ea;border-radius:10px;padding:12px;margin:14px 0;font-size:13.5px}"
                  "details{margin-top:10px;font-size:12.5px;color:#52647a}code{display:block;margin-top:6px;background:#eef3f7;padding:8px;border-radius:7px;word-break:break-all;color:#0b2a55}"
                  "a.btn{display:block;text-align:center;margin-top:16px;padding:13px;background:#0b2a55;color:#fff;text-decoration:none;border-radius:10px;font-weight:700}"
                  "</style></head><body><header class='barra'><img src='/logo.jpg' alt='PIANI'><b>PIANI · Red Local de Emergencia</b></header>"
                  "<main class='wrap'><section class='card'><h1 style='color:");
  html += colorTit;
  html += F("'>");
  html += titulo;
  html += F("</h1><p style='margin:0;color:#52647a'>");
  html += detalle;
  html += F("</p>");
  if (resumen.length() > 0) {
    html += F("<div class='res'>");
    html += resumen;
    html += F("</div>");
  }
  if (trama.length() > 0) {
    html += F("<details><summary>Ver detalle técnico de la trama (");
    html += String(trama.length());
    html += F(" bytes)</summary><code>");
    html += trama;
    html += F("</code></details>");
  }
  html += F("<a class='btn' href='/'>Enviar otro reporte</a></section></main></body></html>");
  server.send(200, "text/html; charset=utf-8", html);
}

void manejarEnvio() {
  String rol     = server.arg("rol");
  String usuario = limpiar(server.arg("usuario"), 22);
  String clave   = server.arg("clave");
  String tipo    = server.arg("tipo");
  if (tipo != "A" && tipo != "R") tipo = "R";

  // Validación de permisos en el servidor: solo brigadistas con clave pueden mandar Albergue (A)
  if (tipo == "A" && !(rol == "brigada" && claveValida(clave))) {
    enviarPaginaResultado("Acceso no autorizado", "#b8222b",
      "Solo brigadistas con clave válida pueden registrar o actualizar cupo oficial de albergues.", "", "");
    return;
  }

  String nombre    = limpiar(server.arg("nombre"), 36);
  String personasS = limpiar(server.arg("personas"), 8);
  String capS      = (tipo == "A") ? limpiar(server.arg("capacidad"), 8) : "";
  String latS      = limpiar(server.arg("lat"), 12);
  String lonS      = limpiar(server.arg("lon"), 12);
  String notaUsr   = limpiar(server.arg("nota"), 55);

  float lat = latS.toFloat();
  float lon = lonS.toFloat();
  long personas = personasS.toInt();

  // Validación de datos en el servidor
  if (nombre.length() < 3 || lat < 17.5 || lat > 21.0 || lon < -99.5 || lon > -96.5 || personas < 0 || personas > 50000) {
    enviarPaginaResultado("Datos incompletos o fuera de rango", "#b8222b",
      "Verifica el nombre del punto, las coordenadas dentro de Puebla y el número de personas.", "", "");
    return;
  }

  const char* codigos[] = {"ag", "al", "me", "am", "co", "tr", "en", "cm"};
  const char* nombresNec[] = {"Agua", "Alimentos", "Medicinas", "Atención médica", "Cobijas", "Traslado", "Energía", "Comunicación"};
  String nec = "";
  String necTxt = "";
  for (int i = 0; i < 8; i++) {
    if (server.hasArg(String("n_") + codigos[i])) {
      if (nec.length() > 0) { nec += ","; necTxt += ", "; }
      nec += codigos[i];
      necTxt += nombresNec[i];
    }
  }

  if (nec.length() == 0 && notaUsr.length() < 4) {
    enviarPaginaResultado("Falta información del reporte", "#b8222b",
      "Selecciona al menos una necesidad urgente o escribe una breve descripción.", "", "");
    return;
  }

  String notaFinal = notaUsr;
  if (usuario.length() >= 3) {
    if (notaFinal.length() > 0) notaFinal += " · ";
    notaFinal += "Por: " + usuario;
  }

  String trama = tipo + "|" + nombre + "|" + String(personas) + "|" + capS + "|" + latS + "|" + lonS + "|" + nec;
  if (notaFinal.length() > 0) trama += "|" + notaFinal;
  if (trama.length() > 235) trama = trama.substring(0, 235);

  int estadoEnvio = enviarEspNow(trama);

  String resumen = "<b>Punto:</b> " + nombre + "<br><b>Personas:</b> " + String(personas);
  if (capS.length() > 0) resumen += " / " + capS;
  if (usuario.length() >= 3) resumen += "<br><b>Reportó:</b> " + usuario;
  if (necTxt.length() > 0) resumen += "<br><b>Insumos:</b> " + necTxt;
  if (notaUsr.length() > 0) resumen += "<br><b>Nota:</b> " + notaUsr;

  if (estadoEnvio == 2) {
    enviarPaginaResultado("Recibido y confirmado por Protección Civil", "#1f7a4c",
      "Tu reporte llegó por radio local sin internet y el puesto de mando devolvió confirmación (ACK).", resumen, trama);
  } else if (estadoEnvio == 1) {
    enviarPaginaResultado("Enviado por radio (sin confirmación del receptor)", "#9a5b00",
      "El paquete salió del nodo, pero no se recibió acuse del receptor ESP32 #2. Verifica que esté encendido y cerca.", resumen, trama);
  } else {
    enviarPaginaResultado("No se pudo transmitir por radio", "#b8222b",
      "Ocurrió un error al enviar el paquete ESP-NOW. Intenta nuevamente.", resumen, trama);
  }
}

void redirigirPortal() {
  server.sendHeader("Location", String("http://") + WiFi.softAPIP().toString() + "/", true);
  server.send(302, "text/plain", "");
}

void setup() {
  Serial.begin(115200);
  pinMode(LED_PIN, OUTPUT);
  pinMode(LED_EXT_PIN, OUTPUT);
  pinMode(BUZZER_PIN, OUTPUT);
  fijarLed(false);
  digitalWrite(BUZZER_PIN, LOW);

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
  Serial.println("=== PIANI · ESP32 #1 (Albergue + Portal Cautivo + ESP-NOW) ===");
  Serial.print("Red Wi-Fi: "); Serial.print(AP_SSID);
  Serial.print(" | Canal real: "); Serial.println(chReal);
  Serial.print("IP Portal: http://"); Serial.println(WiFi.softAPIP());
  Serial.print("Clave brigada: "); Serial.println(CLAVE_BRIGADA);

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
    esp_now_register_recv_cb(alRecibirAck);
    Serial.println(r == ESP_OK ? "ESP-NOW listo en canal " + String(chReal)
                               : "ERROR agregando peer ESP-NOW: " + String((int)r));
  }

  // 3. Portal cautivo oficial PIANI
  dnsServer.start(53, "*", WiFi.softAPIP());
  server.on("/", HTTP_GET, mostrarApp);
  server.on("/logo.jpg", HTTP_GET, servirLogo);
  server.on("/validar", HTTP_GET, validarClave);
  server.on("/enviar", HTTP_POST, manejarEnvio);
  server.on("/generate_204", redirigirPortal);
  server.on("/gen_204", redirigirPortal);
  server.on("/hotspot-detect.html", redirigirPortal);
  server.on("/connecttest.txt", redirigirPortal);
  server.on("/ncsi.txt", redirigirPortal);
  server.on("/fwlink", redirigirPortal);
  server.onNotFound(redirigirPortal);
  server.begin();

  // Prueba rápida de arranque: parpadea LED y suena 1 pitido corto
  fijarLed(true);
  sonar(1400, 80);
  fijarLed(false);
  parpadear(2);
  Serial.println("Listo. Conecta tu celular al Wi-Fi 'PIANI-Albergue'.");
}

void loop() {
  dnsServer.processNextRequest();
  server.handleClient();
  if (ledApagarEn > 0 && millis() >= ledApagarEn) {
    ledApagarEn = 0;
    fijarLed(false);
  }
}
