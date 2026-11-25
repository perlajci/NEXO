// Inicio de sesión: qué se protege, qué sigue abierto, cookie, intentos fallidos y salir.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { crearSesiones, destinoSeguro, esPublico, cookieSesion, claveIgual, INTENTOS_MAX, BLOQUEO_MS, DURACION_MS } from '../lib/sesion.js';

// ---------- Unidades ----------
test('sesión: vence a las 12 horas y se puede cerrar', () => {
  let t = 0;
  const s = crearSesiones({ ahora: () => t });
  const token = s.crear('1.1.1.1');
  assert.match(token, /^[0-9a-f]{64}$/);
  assert.equal(s.valida(token), true);
  assert.equal(s.valida('inventado'), false);
  t = DURACION_MS - 1;
  assert.equal(s.valida(token), true);
  t = DURACION_MS;
  assert.equal(s.valida(token), false, 'vencida');
  const otro = s.crear('1.1.1.1');
  s.cerrar(otro);
  assert.equal(s.valida(otro), false, 'cerrada');
});

test('sesión: tras 5 intentos fallidos se espera 1 minuto', () => {
  let t = 0;
  const s = crearSesiones({ ahora: () => t });
  for (let i = 0; i < INTENTOS_MAX - 1; i++) s.fallo('2.2.2.2');
  assert.equal(s.espera('2.2.2.2'), null, 'aún puede intentar');
  s.fallo('2.2.2.2');
  assert.equal(s.espera('2.2.2.2'), BLOQUEO_MS);
  assert.equal(s.espera('3.3.3.3'), null, 'otra IP no se bloquea');
  t = BLOQUEO_MS;
  assert.equal(s.espera('2.2.2.2'), null, 'pasado el minuto vuelve a intentar');
});

test('sesión: destino, rutas públicas, cookie y comparación de clave', () => {
  assert.equal(destinoSeguro('/#tabulador'), '/#tabulador');
  assert.equal(destinoSeguro('/index.html#reportes'), '/index.html#reportes');
  for (const malo of ['//sitio-falso.com', 'https://sitio-falso.com', '/\\sitio-falso.com', '', '/login.html', 'javascript:alert(1)']) {
    assert.equal(destinoSeguro(malo), '/', malo);
  }
  assert.equal(esPublico('GET', '/cerca.html'), true);
  assert.equal(esPublico('POST', '/api/lora/trama'), true);
  assert.equal(esPublico('GET', '/api/lora/trama'), false);
  assert.equal(esPublico('GET', '/api/confirmaciones'), false);
  assert.equal(esPublico('GET', '/index.html'), false);
  const c = cookieSesion('abc', { segura: true });
  for (const parte of ['piani_sesion=abc', 'HttpOnly', 'SameSite=Lax', 'Path=/', 'Secure', 'Max-Age=43200']) assert.ok(c.includes(parte), parte);
  assert.match(cookieSesion('', { borrar: true }), /Max-Age=0/);
  assert.equal(claveIgual('secreta', 'secreta'), true);
  assert.equal(claveIgual('Secreta', 'secreta'), false);
  assert.equal(claveIgual(undefined, 'secreta'), false);
  assert.equal(claveIgual({ toString: () => 'secreta' }, 'secreta'), false, 'solo texto');
});

// ---------- Servidor con login activo ----------
const CLAVE = 'contraseña-de-prueba';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nexo-ses-'));
process.env.NEXO_DATA = tmp;
process.env.PORT = '0';
process.env.PIANI_CLAVE = CLAVE;
const { servidor } = await import('../server.js');
await new Promise((r) => servidor.listen(0, r));
const base = `http://127.0.0.1:${servidor.address().port}`;
const pedir = (ruta, { metodo = 'GET', cuerpo, cookie, json = true } = {}) => fetch(base + ruta, {
  method: metodo, redirect: 'manual',
  headers: { ...(cookie ? { Cookie: cookie } : {}), ...(cuerpo !== undefined && json ? { 'Content-Type': 'application/json' } : {}) },
  body: cuerpo === undefined ? undefined : (json ? JSON.stringify(cuerpo) : cuerpo),
});
const entrar = (clave) => pedir('/api/sesion/entrar', { metodo: 'POST', cuerpo: { clave } });
test.after(() => { servidor.close(); delete process.env.PIANI_CLAVE; });

test('login: sin sesión el tablero manda al login y la API responde 401', async () => {
  const raiz = await pedir('/');
  assert.equal(raiz.status, 302);
  assert.equal(raiz.headers.get('location'), '/login.html?siguiente=%2F');
  assert.equal((await pedir('/index.html?x=1')).headers.get('location'), '/login.html?siguiente=%2Findex.html%3Fx%3D1');
  const api = await pedir('/api/estado');
  assert.equal(api.status, 401);
  assert.equal(api.headers.get('x-piani-sesion'), 'requerida');
  assert.equal((await pedir('/app.js')).status, 401);
  assert.equal((await pedir('/api/tabulador')).status, 401);
  assert.equal((await pedir('/api/presupuestos', { metodo: 'POST', cuerpo: { obra: 'x', renglones: [] } })).status, 401);
  assert.deepEqual(await (await pedir('/api/sesion')).json(), { requerida: true, activa: false });
});

test('login: la página pública, el login y los reportes de ESP32 siguen abiertos', async () => {
  for (const r of ['/login.html', '/cerca.html', '/sw.js', '/manifest.webmanifest', '/piani-logo.png', '/api/albergues/publicos']) {
    assert.equal((await pedir(r)).status, 200, r);
  }
  assert.equal((await pedir('/piani-logo.png')).headers.get('content-type'), 'image/png');
  const trama = await pedir('/api/lora/trama', { metodo: 'POST', cuerpo: 'A|Albergue prueba|10|50|19.04|-98.2|ag', json: false });
  assert.equal(trama.status, 201, 'el puente USB y la puerta de enlace no tienen sesión');
});

test('login: contraseña equivocada 401; correcta crea la sesión con cookie HttpOnly', async () => {
  const mal = await entrar('otra');
  assert.equal(mal.status, 401);
  assert.equal(mal.headers.get('set-cookie'), null);
  assert.match((await mal.json()).error, /no es correcta/);
  const ok = await entrar(CLAVE);
  assert.equal(ok.status, 200);
  const cookie = ok.headers.get('set-cookie');
  assert.match(cookie, /^piani_sesion=[0-9a-f]{64}; Path=\/; HttpOnly; SameSite=Lax; Max-Age=43200$/);
  assert.doesNotMatch(cookie, /Secure/, 'en http://localhost no se marca Secure');
  const token = cookie.split(';')[0];
  assert.equal((await pedir('/', { cookie: token })).status, 200);
  assert.equal((await pedir('/api/estado', { cookie: token })).status, 200);
  assert.deepEqual(await (await pedir('/api/sesion', { cookie: token })).json(), { requerida: true, activa: true });
  // Salir: la cookie deja de servir.
  const salir = await pedir('/api/sesion/salir', { metodo: 'POST', cookie: token });
  assert.match(salir.headers.get('set-cookie'), /Max-Age=0/);
  assert.equal((await pedir('/api/estado', { cookie: token })).status, 401);
  assert.equal((await pedir('/api/estado', { cookie: 'piani_sesion=inventada' })).status, 401);
});

test('login: después de 5 intentos fallidos responde 429 aunque la contraseña sea correcta', async () => {
  for (let i = 0; i < INTENTOS_MAX; i++) assert.equal((await entrar('mala')).status, 401);
  const bloqueado = await entrar(CLAVE);
  assert.equal(bloqueado.status, 429);
  assert.ok(Number(bloqueado.headers.get('retry-after')) > 0);
  assert.match((await bloqueado.json()).error, /Espera \d+ segundos/);
});
