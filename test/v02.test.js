// Pruebas de la v0.2 (municipios, albergues sugeridos, rutas, tramas) con datos de PRUEBA y sin red.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodificarPolilinea } from '../lib/rutas.js';
import { parsearTrama } from '../lib/trama.js';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nexo2-'));
fs.mkdirSync(path.join(tmp, 'iter'));
fs.mkdirSync(path.join(tmp, 'cache'));
fs.copyFileSync(path.join(DIR, 'fixture/iter/iter_prueba.csv'), path.join(tmp, 'iter/iter_prueba.csv'));
process.env.NEXO_DATA = tmp;
process.env.PORT = '0';
process.env.OSRM_URL = 'http://127.0.0.1:9'; // fuerza el modo sin conexión
delete process.env.GOOGLE_MAPS_API_KEY;
const { iniciar, servidor } = await import('../server.js');
await iniciar();
const base = `http://127.0.0.1:${servidor.address().port}`;
const get = (p) => fetch(base + p).then(async (r) => ({ s: r.status, j: await r.json() }));
const post = (p, b, tipo = 'application/json') => fetch(base + p, { method: 'POST', headers: { 'content-type': tipo }, body: typeof b === 'string' ? b : JSON.stringify(b) }).then(async (r) => ({ s: r.status, j: await r.json() }));
test.after(() => servidor.close());

test('polilínea de Google (ejemplo oficial)', () => {
  const p = decodificarPolilinea('_p~iF~ps|U_ulLnnqC_mqNvxq`@');
  assert.deepEqual(p, [[38.5, -120.2], [40.7, -120.95], [43.252, -126.453]]);
});

test('trama corta con abreviaturas', () => {
  const t = parsearTrama('A|Alb Sec 12|85|150|19.04|-98.41|ag,me');
  assert.equal(t.tipo, 'albergue');
  assert.deepEqual(t.necesidades, ['agua', 'medicinas']);
  assert.ok(t.bytes < 60);
  assert.throws(() => parsearTrama('X|a'));
});

test('resumen de municipios y ficha', async () => {
  const { s, j } = await get('/api/municipios/resumen?fenomeno=volcanico&mes=1');
  assert.equal(s, 200);
  assert.equal(j.municipios.length, 2);
  assert.equal(j.estatal.poblacion, 1808);
  const a = j.municipios.find((m) => m.mun === '001');
  assert.equal(a.poblacion, 1500);
  assert.ok(a.lat > 19 && a.lon < -98.3);
  const f = await get('/api/municipio/001?fenomeno=volcanico');
  assert.equal(f.s, 200);
  assert.equal(f.j.agregados.total.POBTOT, 1500);
  assert.equal(f.j.lugarEstatal.total, 2);
  assert.equal((await get('/api/municipio/999')).s, 404);
});

test('albergues sugeridos fuera de la zona de peligro', async () => {
  const { s, j } = await post('/api/albergues/sugerir', { fenomeno: 'volcanico', k: 3, radioKm: 40, pobMinCandidato: 200, porcentajeAlbergue: 20 });
  assert.equal(s, 200);
  assert.equal(j.sitios.length, 1, JSON.stringify(j.resumen));
  assert.equal(j.sitios[0].nom, 'Localidad Dos');
  assert.ok(j.sitios[0].peligroLocal <= 0.4);
  assert.equal(j.resumen.demandaPoblacion, 1008);
  assert.equal(j.resumen.porcentaje, 100);
  assert.equal(j.sitios[0].capacidadSugerida, Math.ceil(1008 * 0.2));
  const nada = await post('/api/albergues/sugerir', { fenomeno: 'volcanico', pobMinCandidato: 100000 });
  assert.equal(nada.j.sitios.length, 0);
});

test('ruta sin conexión cae a línea recta', async () => {
  const { s, j } = await get('/api/ruta?origen=19.04,-98.2&destino=19.06,-98.62');
  assert.equal(s, 200);
  assert.equal(j.estimada, true);
  assert.ok(j.distanciaKm > 40 && j.duracionMin > 0);
  assert.equal((await get('/api/ruta?origen=x')).s, 400);
});

test('trama por API: crea, actualiza y bases no cuentan como confirmados', async () => {
  const a = await post('/api/lora/trama', 'A|Albergue Norte|40|100|19.05|-98.60|ag', 'text/plain');
  assert.equal(a.s, 201);
  assert.equal(a.j.fuente, 'lora');
  const b = await post('/api/lora/trama', { trama: 'A|Albergue Norte|55|100|19.05|-98.60|ag,co', rssi: -97, via: 'wifi' });
  assert.equal(b.s, 200);
  assert.equal(b.j.personas, 55);
  assert.match(b.j.nota, /WIFI.*RSSI -97/);
  await post('/api/confirmaciones', { tipo: 'base', nombre: 'Cruz Roja', lat: 19.04, lon: -98.62, personas: 0 });
  const g = await post('/api/geocerca', { geocerca: { tipo: 'circulo', centro: [19.0225, -98.6278], radioKm: 12 }, fenomeno: 'volcanico' });
  assert.equal(g.j.operacion.confirmados, 55);
  const c = await get('/api/cercano?lat=19.0&lon=-98.6&tipo=base');
  assert.equal(c.j[0].nombre, 'Cruz Roja');
  const pub = await get('/api/albergues/publicos');
  assert.equal(pub.j.albergues.length, 1);
  assert.equal(pub.j.albergues[0].nota, undefined);
});
