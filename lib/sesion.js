// Inicio de sesión de PIANI con una contraseña del equipo.
//
// - La contraseña vive solo en la variable de entorno PIANI_CLAVE (nunca en el código ni en el repo).
//   Si la variable no existe, el login está apagado y PIANI funciona abierto, como antes.
// - Al entrar se crea una sesión con un token aleatorio en una cookie HttpOnly (el JavaScript de la
//   página no puede leerla). Las sesiones viven en memoria: al reiniciar el servidor hay que volver a entrar.
// - Tras varios intentos fallidos desde la misma IP se pide esperar, para frenar a quien adivina.
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';

export const COOKIE = 'piani_sesion';
export const DURACION_MS = 12 * 60 * 60 * 1000; // 12 horas
export const INTENTOS_MAX = 5;
export const BLOQUEO_MS = 60 * 1000; // 1 minuto tras 5 fallos

// Lo que funciona sin sesión: el login, la página pública del albergue más cercano (que se usa sin
// internet) y la entrada de reportes de los ESP32 (el puente USB y la puerta de enlace no tienen sesión).
const PUBLICO = new Set([
  'GET /login.html', 'GET /piani-logo.png', 'GET /cerca.html', 'GET /sw.js', 'GET /manifest.webmanifest',
  'GET /api/albergues/publicos', 'POST /api/lora/trama',
  'GET /api/sesion', 'POST /api/sesion/entrar', 'POST /api/sesion/salir',
]);
export const esPublico = (metodo, ruta) => PUBLICO.has(`${metodo === 'HEAD' ? 'GET' : metodo} ${ruta}`);

// Compara en tiempo constante (sobre SHA-256 para igualar longitudes).
export function claveIgual(enviada, esperada) {
  if (typeof enviada !== 'string' || !enviada || !esperada) return false;
  const h = (s) => createHash('sha256').update(String(s)).digest();
  return timingSafeEqual(h(enviada), h(esperada));
}

export function leerCookie(req, nombre) {
  for (const parte of String(req.headers.cookie || '').split(';')) {
    const i = parte.indexOf('=');
    if (i > 0 && parte.slice(0, i).trim() === nombre) return decodeURIComponent(parte.slice(i + 1).trim());
  }
  return null;
}

// Solo rutas internas: evita que ?siguiente= mande a otro sitio ("//sitio-falso.com").
export function destinoSeguro(siguiente) {
  const s = String(siguiente || '');
  return /^\/(?!\/)[^\s\\]*$/.test(s) && !s.startsWith('/login.html') ? s : '/';
}

export function crearSesiones({ ahora = () => Date.now() } = {}) {
  const sesiones = new Map(); // token -> { vence }
  const fallos = new Map(); // ip -> { n, hasta }
  const limpiar = () => {
    const t = ahora();
    for (const [k, s] of sesiones) if (s.vence <= t) sesiones.delete(k);
    for (const [k, f] of fallos) if (f.hasta && f.hasta <= t) fallos.delete(k);
  };
  return {
    // null = puede intentar; número = milisegundos que debe esperar.
    espera(ip) {
      const f = fallos.get(ip);
      return f?.hasta && f.hasta > ahora() ? f.hasta - ahora() : null;
    },
    fallo(ip) {
      const f = fallos.get(ip) || { n: 0, hasta: 0 };
      f.n += 1;
      if (f.n >= INTENTOS_MAX) { f.hasta = ahora() + BLOQUEO_MS; f.n = 0; }
      fallos.set(ip, f);
    },
    crear(ip) {
      limpiar();
      fallos.delete(ip);
      const token = randomBytes(32).toString('hex');
      sesiones.set(token, { vence: ahora() + DURACION_MS });
      return token;
    },
    valida(token) {
      const s = token && sesiones.get(token);
      if (!s) return false;
      if (s.vence <= ahora()) { sesiones.delete(token); return false; }
      return true;
    },
    cerrar(token) { if (token) sesiones.delete(token); },
  };
}

// Encabezado Set-Cookie. "Secure" solo cuando la página llega por HTTPS (en Render sí; en localhost no).
export function cookieSesion(token, { segura = false, borrar = false } = {}) {
  const partes = [`${COOKIE}=${borrar ? '' : encodeURIComponent(token)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${borrar ? 0 : Math.floor(DURACION_MS / 1000)}`];
  if (segura) partes.push('Secure');
  return partes.join('; ');
}
