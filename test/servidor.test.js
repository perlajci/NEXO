// Prueba de extremo a extremo del servidor con datos de PRUEBA y caché sembrada (sin red).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nexo-'));
fs.mkdirSync(path.join(tmp, 'iter'));
fs.mkdirSync(path.join(tmp, 'cache'));
fs.copyFileSync(path.join(DIR, 'fixture/iter/iter_prueba.csv'), path.join(tmp, 'iter/iter_prueba.csv'));
const w = (n, d) => fs.writeFileSync(path.join(tmp, 'cache', `${n}.json`), JSON.stringify(d));
const eventos = [];
for (let i = 0; i < 60; i++) eventos.push({ id: `e${i}`, mag: 4.5 + (i % 10) / 10, lat: 18.5 + (i % 5) / 10, lon: -98.5 + (i % 3) / 10, prof: 50, fecha: `20${10 + (i % 15)}-01-01T00:00:00.000Z`, lugar: 'prueba' });
w('usgs_1980-01-01_4.5', { fuente: 'prueba', desde: '1980-01-01', magMin: 4.5, eventos });
const meses = Array.from({ length: 12 }, (_, i) => ({ precip: i === 6 ? 200 : 10, heladas: i === 0 ? 8 : 0 }));
w('clima_2020-01-01_2024-12-31', { fuente: 'prueba', inicio: '2020-01-01', fin: '2024-12-31', celdas: [{ lat: 19.25, lon: -98.75, meses }, { lat: 18.25, lon: -97.25, meses: meses.map(() => ({ precip: 50, heladas: 1 })) }] });
const ahora = Date.now();
const time = Array.from({ length: 48 }, (_, i) => new Date(ahora + (i - 2) * 36e5).toISOString().slice(0, 16));
w('viento_19.02_-98.63', { fuente: 'prueba', horario: { time, wind_direction_500hPa: time.map(() => 270), wind_speed_500hPa: time.map(() => 30) } });

process.env.NEXO_DATA = tmp;
process.env.PORT = '0';
const { iniciar, servidor } = await import('../server.js');
await iniciar();
const base = `http://127.0.0.1:${servidor.address().port}`;
const get = (p) => fetch(base + p).then(async (r) => ({ s: r.status, j: await r.json() }));
const post = (p, b) => fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }).then(async (r) => ({ s: r.status, j: await r.json() }));
await new Promise((r) => setTimeout(r, 300));
test.after(() => servidor.close());

test('estado', async () => {
  const { s, j } = await get('/api/estado');
  assert.equal(s, 200);
  assert.equal(j.iter.localidades, 4);
  assert.equal(j.sismos.eventos, 60);
  assert.equal(j.clima.celdas, 2);
});

test('localidades con riesgo estacional', async () => {
  const jul = (await get('/api/localidades?fenomeno=lluvias&mes=7')).j;
  const ene = (await get('/api/localidades?fenomeno=lluvias&mes=1')).j;
  const i = jul.columnas.indexOf('P');
  const uno = (d) => d.datos.find((x) => x[1] === 'Localidad Uno, Centro')[i];
  assert.equal(uno(jul), 1);
  assert.ok(uno(ene) < 0.1);
});

test('geocerca Popocatépetl 12 km', async () => {
  const { s, j } = await post('/api/geocerca', { geocerca: { tipo: 'circulo', centro: [19.0225, -98.6278], radioKm: 12 }, fenomeno: 'volcanico', mes: 11 });
  assert.equal(s, 200);
  assert.equal(j.agregados.total.POBTOT, 1008);
  assert.equal(j.agregados.poblacionConDatoReservado.P_60YMAS, 8);
  assert.equal(j.operacion.expuestos, 1008);
  assert.equal(j.porNivel.muy_alto.poblacion + j.porNivel.alto.poblacion + j.porNivel.medio.poblacion + j.porNivel.bajo.poblacion, 1008);
});

test('confirmaciones descuentan de sin confirmar', async () => {
  const c = await post('/api/confirmaciones', { nombre: 'Albergue prueba', lat: 19.06, lon: -98.62, personas: 300, necesidades: ['agua', 'hack'], fuente: 'lora' });
  assert.equal(c.s, 201);
  assert.deepEqual(c.j.necesidades, ['agua']);
  assert.equal(c.j.fuente, 'lora');
  const { j } = await post('/api/geocerca', { geocerca: { tipo: 'circulo', centro: [19.0225, -98.6278], radioKm: 12 }, fenomeno: 'volcanico' });
  assert.equal(j.operacion.confirmados, 300);
  assert.equal(j.operacion.sinConfirmar, 708);
  assert.equal(j.operacion.necesidades.agua, 1);
  const mal = await post('/api/confirmaciones', { lat: 'x', lon: 1, personas: 3 });
  assert.equal(mal.s, 400);
});

test('filtros por municipio y nivel', async () => {
  const g = { tipo: 'circulo', centro: [19.0, -98.3], radioKm: 200 };
  const a = (await post('/api/geocerca', { geocerca: g, fenomeno: 'volcanico', filtros: { mun: '002' } })).j;
  assert.equal(a.agregados.total.POBTOT, 308);
  const b = (await post('/api/geocerca', { geocerca: g, fenomeno: 'volcanico', filtros: { niveles: ['muy_alto', 'alto'] } })).j;
  assert.ok(b.agregados.total.POBTOT >= 1000 && b.agregados.total.POBTOT < 1808);
});

test('sismos con Gutenberg-Richter', async () => {
  const { s, j } = await get('/api/sismos?lat=18.7&lon=-98.4&radioKm=150&magMin=4.5');
  assert.equal(s, 200);
  assert.equal(j.total, 60);
  assert.ok(j.gutenbergRichter.suficiente);
  assert.equal(j.maxima.mag, 5.4);
});

test('ceniza: viento del oeste empuja hacia el este', async () => {
  const { s, j } = await get('/api/ceniza?horas=24&semi=35');
  assert.equal(s, 200, JSON.stringify(j));
  assert.equal(j.vientoDesde, 270);
  assert.equal(j.haciaGrados, 90);
  // Localidad Dos (rumbo ~62° desde el volcán) cae dentro de un cono de 90°±35°.
  assert.ok(j.resumen.agregados.total.POBTOT >= 500);
});

test('geocerca inválida y estáticos seguros', async () => {
  const r = await post('/api/geocerca', { geocerca: { tipo: 'poligono', puntos: [[1, 1]] } });
  assert.equal(r.s, 400);
  const t = await fetch(base + '/..%2f..%2fpackage.json');
  assert.notEqual(t.status, 200);
});
