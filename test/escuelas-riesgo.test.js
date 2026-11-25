// Riesgo por escuela y API de escuelas (paso 2). Usa el censo de prueba (test/fixture/iter) y las
// escuelas de prueba (test/fixture/escuelas/escuelas_prueba.csv): cifras, CCT (21ZZZ…), coordenadas
// y matrículas INVENTADAS solo para probar el código. Sin red: sismos y clima van sembrados en caché.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { procesarITER } from '../lib/iter.js';
import { distanciaKm } from '../lib/geo.js';
import { calcularVulnerabilidad, prepararSismico, peligroSismicoEnPunto } from '../lib/riesgo.js';
import {
  crearIndiceLocalidades, prepararEscuelas, riesgoEscuela, riesgoPorFenomeno, filtrarEscuelas, resumenEscuelas, enPeligro,
} from '../lib/riesgo-escuelas.js';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const { localidades } = procesarITER(fs.readFileSync(path.join(DIR, 'fixture/iter/iter_prueba.csv'), 'utf8'));
calcularVulnerabilidad(localidades);
const esc = (o) => ({
  id: o.cct, cct: o.cct, nombre: o.nombre || 'Escuela de prueba', nivel: o.nivel || 'primaria', municipio: o.municipio || 'Municipio A',
  localidad: '', lat: o.lat, lon: o.lon, alumnos: o.alumnos ?? null, es_inmueble_escolar: o.es_inmueble_escolar ?? true,
});

// ---------- Unidades ----------
test('riesgo escuelas: el índice en rejilla encuentra la misma localidad que una búsqueda completa', () => {
  // Rejilla sintética de localidades separadas de forma irregular por todo el estado.
  const locs = [];
  for (let i = 0; i < 400; i++) locs.push({ id: `L${i}`, lat: 17.9 + ((i * 37) % 290) / 100, lon: -99 + ((i * 53) % 230) / 100 });
  const idx = crearIndiceLocalidades(locs);
  for (let k = 0; k < 300; k++) {
    const lat = 18 + ((k * 7919) % 2700) / 1000;
    const lon = -98.9 + ((k * 104729) % 2100) / 1000;
    const bruto = locs.reduce((m, l) => (distanciaKm(lat, lon, l.lat, l.lon) < distanciaKm(lat, lon, m.lat, m.lon) ? l : m));
    assert.equal(idx.cercana(lat, lon).localidad.id, bruto.id, `punto ${lat},${lon}`);
  }
  assert.equal(crearIndiceLocalidades([]).cercana(19, -98), null);
});

test('riesgo escuelas: vulnerabilidad de la localidad más cercana, distancia y municipio', () => {
  const [a, b] = prepararEscuelas([
    esc({ cct: '21ZZZ0001A', lat: 19.17, lon: -98.33, municipio: 'Municipio A' }),
    esc({ cct: '21ZZZ0002B', lat: 18.51, lon: -97.51, municipio: 'Nombre que no está en el censo' }),
  ], localidades);
  assert.equal(a.loc.nom, 'Localidad Dos');
  assert.equal(a.V, 0.5);
  assert.equal(a.distLocKm, 0.51, '≈370 m al norte y ≈350 m al este');
  assert.deepEqual([a.mun, a.munPorNombre], ['001', true]);
  assert.deepEqual([b.loc.nom, b.mun, b.munPorNombre], ['Localidad Tres', '002', false], 'sin coincidencia de nombre usa el municipio de la localidad cercana');
});

test('riesgo escuelas: volcánico en el punto de la escuela; sin vulnerabilidad usa 0.5', () => {
  const [cerca, lejos] = prepararEscuelas([
    esc({ cct: '21ZZZ0007G', lat: 19.058333, lon: -98.608333 }), // junto a "Localidad Reservada" (sin V), ~4 km del cráter
    esc({ cct: '21ZZZ0003C', lat: 18.501528, lon: -97.502833 }),
  ], localidades);
  assert.deepEqual(riesgoEscuela(cerca, 'volcanico', 11, null), { p: 1, V: null, r: 0.75, nivel: 'muy_alto' });
  const r = riesgoEscuela(lejos, 'volcanico', 11, null);
  assert.equal(r.p, 0.05);
  assert.equal(r.nivel, 'bajo');
  assert.equal(enPeligro('muy_alto'), true);
  assert.equal(enPeligro('alto'), true);
  assert.equal(enPeligro('medio'), false);
  assert.equal(enPeligro(null), false);
});

test('riesgo escuelas: sísmico en el punto es comparable con el de las localidades; lluvias cambia con el mes', () => {
  const sismos = [{ lat: 19.1, lon: -98.4, mag: 6 }, { lat: 18.6, lon: -97.6, mag: 5 }];
  const info = prepararSismico(localidades, sismos);
  for (const l of localidades) assert.equal(peligroSismicoEnPunto(l.lat, l.lon, sismos, info), l._sis, `misma cifra en ${l.nom}`);
  assert.equal(peligroSismicoEnPunto(19, -98, null, info), null, 'sin catálogo: sin dato');

  const meses = Array.from({ length: 12 }, (_, i) => ({ precip: i === 6 ? 200 : 10, heladas: 0 }));
  const malla = [{ lat: 19.25, lon: -98.75, meses }, { lat: 18.25, lon: -97.25, meses: meses.map(() => ({ precip: 50, heladas: 1 })) }];
  const [pt] = prepararEscuelas([esc({ cct: '21ZZZ0001A', lat: 19.17, lon: -98.33 })], localidades, { sismos, sismoInfo: info, malla });
  const maximos = { precip: 200, heladas: 1 };
  assert.equal(riesgoEscuela(pt, 'lluvias', 7, maximos).nivel, 'muy_alto');
  assert.equal(riesgoEscuela(pt, 'lluvias', 1, maximos).nivel, 'bajo');
  assert.deepEqual(Object.keys(riesgoPorFenomeno(pt, 7, maximos)), ['volcanico', 'sismico', 'lluvias', 'heladas']);
});

test('riesgo escuelas: filtros y resumen (alumnos solo si hay dato)', () => {
  const puntos = prepararEscuelas([
    esc({ cct: '21ZZZ0007G', nombre: 'Bachillerato de prueba', nivel: 'media superior', lat: 19.058333, lon: -98.608333, municipio: 'Municipio B', alumnos: 80 }),
    esc({ cct: '21ZZZ0001A', nombre: 'Primaria de prueba', lat: 19.17, lon: -98.33, alumnos: 470 }),
    esc({ cct: '21ZZZ0003C', nombre: 'Secundaria de prueba', nivel: 'secundaria', lat: 18.5, lon: -97.5, municipio: 'Municipio B' }),
  ], localidades);
  const filas = puntos.map((p) => {
    const riesgo = riesgoEscuela(p, 'volcanico', 11, null);
    return { ...p, riesgo, enPeligro: enPeligro(riesgo.nivel), afectada: p.e.cct === '21ZZZ0003C' };
  });
  const ccts = (l) => l.map((f) => f.e.cct);
  assert.deepEqual(ccts(filtrarEscuelas(filas, { estado: 'peligro' })), ['21ZZZ0007G']);
  assert.deepEqual(ccts(filtrarEscuelas(filas, { estado: 'afectada' })), ['21ZZZ0003C']);
  assert.deepEqual(ccts(filtrarEscuelas(filas, { estado: 'peligro_afectada' })), ['21ZZZ0007G', '21ZZZ0003C']);
  assert.deepEqual(ccts(filtrarEscuelas(filas, { nivel: 'secundaria' })), ['21ZZZ0003C']);
  assert.deepEqual(ccts(filtrarEscuelas(filas, { mun: '2' })), ['21ZZZ0007G', '21ZZZ0003C'], 'clave sin ceros');
  assert.deepEqual(ccts(filtrarEscuelas(filas, { mun: 'municipio a' })), ['21ZZZ0001A'], 'o nombre');
  assert.deepEqual(ccts(filtrarEscuelas(filas, { buscar: 'bachillerato' })), ['21ZZZ0007G']);
  assert.deepEqual(ccts(filtrarEscuelas(filas, { buscar: '21zzz0001' })), ['21ZZZ0001A'], 'por CCT');
  assert.deepEqual(ccts(filtrarEscuelas(filas, { riesgo: ['bajo'] })), ['21ZZZ0003C']);

  const r = resumenEscuelas(filas);
  assert.deepEqual([r.total, r.enPeligro, r.afectadas, r.alumnosExpuestos, r.escuelasConAlumnos], [3, 1, 1, 80, 2]);
  assert.match(r.avisoAlumnos, /Solo 2 de 3/);
  assert.deepEqual(r.porRiesgo, { muy_alto: 1, alto: 0, medio: 1, bajo: 1, sin_dato: 0 });
  assert.deepEqual(r.porMunicipio.map((m) => [m.mun, m.total, m.enPeligro, m.afectadas]), [['002', 2, 1, 1], ['001', 1, 0, 0]]);
  assert.deepEqual(r.porNivel.map((n) => [n.nivel, n.enPeligro]), [['media superior', 1], ['secundaria', 0], ['primaria', 0]]);

  const sin = resumenEscuelas(filas.map((f) => ({ ...f, e: { ...f.e, alumnos: null } })));
  assert.equal(sin.alumnosExpuestos, null, 'sin dato de alumnos no se cuenta 0');
  assert.match(sin.avisoAlumnos, /no trae número de alumnos/);
  assert.equal(sin.porNivel[0].alumnosExpuestos, null);
});

// ---------- API ----------
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nexo-escr-'));
for (const d of ['iter', 'cache', 'escuelas']) fs.mkdirSync(path.join(tmp, d));
fs.copyFileSync(path.join(DIR, 'fixture/iter/iter_prueba.csv'), path.join(tmp, 'iter/iter_prueba.csv'));
fs.copyFileSync(path.join(DIR, 'fixture/escuelas/escuelas_prueba.csv'), path.join(tmp, 'escuelas/escuelas_prueba.csv'));
const w = (n, d) => fs.writeFileSync(path.join(tmp, 'cache', `${n}.json`), JSON.stringify(d));
w('usgs_1980-01-01_4.5', { fuente: 'prueba', desde: '1980-01-01', magMin: 4.5, eventos: [{ id: 'a', lat: 19.1, lon: -98.4, mag: 6, prof: 10, fecha: '2017-09-19T00:00:00.000Z', lugar: 'prueba' }] });
const meses = Array.from({ length: 12 }, (_, i) => ({ precip: i === 6 ? 200 : 10, heladas: 0 }));
w('clima_2020-01-01_2024-12-31', { fuente: 'prueba', inicio: '2020-01-01', fin: '2024-12-31', celdas: [{ lat: 19.25, lon: -98.75, meses }, { lat: 18.25, lon: -97.25, meses: meses.map(() => ({ precip: 50, heladas: 1 })) }] });
process.env.NEXO_DATA = tmp;
process.env.PORT = '0';
delete process.env.PIANI_CLAVE;
const { iniciar, servidor } = await import('../server.js');
await iniciar();
await new Promise((r) => setTimeout(r, 200)); // los sismos se cargan en segundo plano
const base = `http://127.0.0.1:${servidor.address().port}`;
const get = (p) => fetch(base + p).then(async (r) => ({ s: r.status, j: await r.json() }));
const post = (p, b) => fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }).then(async (r) => ({ s: r.status, j: await r.json() }));
test.after(() => servidor.close());
const filasDe = (j) => j.datos.map((d) => Object.fromEntries(j.columnas.map((c, i) => [c, d[i]])));

test('API /api/escuelas: lista con nivel de riesgo y estado, y filtros', async () => {
  const { s, j } = await get('/api/escuelas?fenomeno=volcanico&mes=11');
  assert.equal(s, 200);
  assert.equal(j.total, 5);
  assert.deepEqual(j.columnas.slice(0, 4), ['id', 'cct', 'nombre', 'nivel']);
  const siete = filasDe(j).find((f) => f.cct === '21ZZZ0007G');
  assert.deepEqual([siete.riesgo, siete.enPeligro, siete.afectada, siete.mun, siete.P, siete.R], ['muy_alto', true, false, '002', 1, 0.75]);
  const peligro = await get('/api/escuelas?fenomeno=volcanico&mes=11&estado=peligro');
  assert.deepEqual(filasDe(peligro.j).map((f) => f.cct), ['21ZZZ0007G']);
  assert.equal((await get('/api/escuelas?fenomeno=volcanico&mes=11&estado=afectada')).j.total, 0, 'sin reportes todavía');
  assert.equal((await get('/api/escuelas?nivel=secundaria')).j.total, 1);
  assert.equal((await get('/api/escuelas?nivel=inventado')).j.filtros.nivel, '', 'nivel desconocido se ignora');
  assert.equal((await get('/api/escuelas?mun=001')).j.total, 2);
  assert.equal((await get(`/api/escuelas?buscar=${encodeURIComponent('prueba siete')}`)).j.total, 1);
  assert.equal((await get('/api/escuelas?limite=2')).j.datos.length, 2);
});

test('API /api/escuelas: recalcula al cambiar fenómeno o mes', async () => {
  const julio = await get('/api/escuelas?fenomeno=lluvias&mes=7&estado=peligro');
  const enero = await get('/api/escuelas?fenomeno=lluvias&mes=1&estado=peligro');
  assert.ok(julio.j.total >= 2, `julio: ${julio.j.total}`);
  assert.equal(enero.j.total, 0);
  const sis = await get('/api/escuelas?fenomeno=sismico&mes=11');
  assert.ok(filasDe(sis.j).every((f) => f.P !== null), 'con catálogo sísmico todas tienen peligro');
});

test('API /api/escuelas/resumen: totales, alumnos expuestos y desglose', async () => {
  const { s, j } = await get('/api/escuelas/resumen?fenomeno=volcanico&mes=11');
  assert.equal(s, 200);
  assert.deepEqual([j.total, j.enPeligro, j.afectadas, j.alumnosExpuestos], [5, 1, 0, 80]);
  assert.match(j.avisoAlumnos, /Solo 4 de 5/);
  assert.deepEqual(j.porMunicipio.map((m) => [m.mun, m.enPeligro]), [['002', 1], ['001', 0]]);
  assert.equal(j.porNivel[0].nivel, 'media superior');
});

test('API /api/escuela/:cct: ficha con riesgo por fenómeno, población en 2 km y albergue más cercano', async () => {
  let f = await get('/api/escuela/21zzz0007g?fenomeno=volcanico&mes=11');
  assert.equal(f.s, 200);
  assert.equal(f.j.escuela.cct, '21ZZZ0007G');
  assert.deepEqual(f.j.escuela.turnos, ['MATUTINO', 'VESPERTINO']);
  assert.equal(f.j.localidadCercana.nom, 'Localidad Reservada');
  assert.equal(f.j.localidadCercana.distanciaKm, 0);
  assert.deepEqual(Object.keys(f.j.riesgoPorFenomeno), ['volcanico', 'sismico', 'lluvias', 'heladas']);
  assert.equal(f.j.riesgo.nivel, 'muy_alto');
  // "Localidad Uno, Centro" (1000 hab.) está a ~1 km; "Localidad Reservada" (8 hab.) en el mismo punto.
  assert.equal(f.j.poblacion2km.total.POBTOT, 1008);
  assert.equal(f.j.poblacion2km.total.localidades, 2);
  assert.equal(f.j.albergueCercano, null, 'todavía no hay albergues');
  assert.deepEqual([f.j.reportes, f.j.historial], [[], []]);

  await post('/api/confirmaciones', { tipo: 'albergue', nombre: 'Albergue lejano de prueba', lat: 18.5, lon: -97.5, personas: 1 });
  await post('/api/confirmaciones', { tipo: 'albergue', nombre: 'Albergue cercano de prueba', lat: 19.07, lon: -98.6, personas: 3, capacidad: 50 });
  f = await get('/api/escuela/21ZZZ0007G');
  assert.equal(f.j.albergueCercano.nombre, 'Albergue cercano de prueba');
  assert.ok(f.j.albergueCercano.distanciaKm < 2);
  assert.equal((await get('/api/escuela/21ZZZ9999Z')).s, 404);
});
