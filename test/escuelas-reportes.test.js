// Reportes de daño en escuelas (paso 3): validación, estado de daño, mismo inmueble, trama con CCT
// y API. Escuelas, CCT (21ZZZ…), domicilios y coordenadas INVENTADOS solo para probar el código.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  normalizarDano, crearReporteEscuela, cambiarEstadoReporte, estadoDano, danoPorEscuela, reportesDeEscuela, ErrorReporte,
} from '../lib/reportes-escuelas.js';
import { cargarEscuelasDesdeCarpeta, limpio } from '../lib/escuelas.js';
import { parsearTrama } from '../lib/trama.js';

const DIR = path.dirname(fileURLToPath(import.meta.url));
// Tres CCT en la misma coordenada: dos con el mismo domicilio (mismo inmueble) y una con otro
// domicilio (coordenada genérica, otro inmueble). Una cuarta, lejos.
const CSV = `cct,nombre,nivel,latitud,longitud,vialidad,colonia,cp
21ZZZ0201A,Primaria de prueba (dato inventado),primaria,19.058333,-98.608333,Calle Uno 1,Centro,72000
21ZZZ0202B,Secundaria de prueba (dato inventado),secundaria,19.058333,-98.608333,calle uno 1,Centro,72000
21ZZZ0203C,Preescolar de prueba en otra calle (dato inventado),preescolar,19.058333,-98.608333,Calle Dos 5,Centro,72000
21ZZZ0204D,Primaria lejana de prueba (dato inventado),primaria,18.5,-97.5,Ninguno Ninguno,Ninguno,0
`;
const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'nexo-rep-esc-'));
fs.writeFileSync(path.join(carpeta, 'escuelas.csv'), CSV);
const { escuelas } = cargarEscuelasDesdeCarpeta(carpeta);
const porCct = (c) => escuelas.find((e) => e.cct === c);
const T0 = new Date('2026-11-20T10:00:00Z');
const rep = (cct, dano, estado = 'pendiente', fecha = '2026-11-20T09:00:00Z') => crearReporteEscuela({ dano, estado, fecha }, porCct(cct), { ahora: T0 });

// ---------- Inmueble ----------
test('inmueble: misma coordenada y mismo domicilio; otra calle en la misma coordenada es otro inmueble', () => {
  const [a, b, c, d] = ['21ZZZ0201A', '21ZZZ0202B', '21ZZZ0203C', '21ZZZ0204D'].map(porCct);
  assert.equal(a.inmueble_id, b.inmueble_id, 'mayúsculas distintas en el domicilio no importan');
  assert.notEqual(a.inmueble_id, c.inmueble_id);
  assert.match(a.inmueble_id, /^INM_19\.05833_-98\.60833_[0-9a-f]{6}$/);
  assert.deepEqual([a.coordenada_compartida, c.coordenada_compartida, d.coordenada_compartida], [1, 2, 0]);
  assert.equal(d.domicilio, '', '"Ninguno" y CP 0 quedan vacíos');
  assert.equal(d.inmueble_id, 'INM_18.50000_-97.50000');
  assert.equal(limpio('Ninguno Ninguno'), '');
});

// ---------- Reglas ----------
test('reportes: daño, origen, estado y fecha se validan', () => {
  assert.deepEqual(['Grave', 'sin daño', 'in', 'INHABITABLE', 'x'].map(normalizarDano), ['grave', 'sin_dano', 'inhabitable', 'inhabitable', null]);
  const r = rep('21ZZZ0201A', 'moderado');
  assert.deepEqual([r.tipo, r.cct, r.dano, r.origen, r.estado, r.fecha_dano], ['escuela', '21ZZZ0201A', 'moderado', 'manual', 'pendiente', '2026-11-20T09:00:00.000Z']);
  assert.equal(r.inmueble_id, porCct('21ZZZ0201A').inmueble_id);
  assert.match(r.nota, /Daño moderado \(pendiente\) · CCT 21ZZZ0201A/);
  assert.deepEqual(r.historial.map((h) => h.accion), ['creado']);
  assert.throws(() => crearReporteEscuela({ dano: 'muy feo' }, porCct('21ZZZ0201A')), ErrorReporte);
  assert.throws(() => crearReporteEscuela({ dano: 'leve', fecha: 'ayer' }, porCct('21ZZZ0201A')), /Fecha inválida/);
  assert.throws(() => crearReporteEscuela({ dano: 'leve', fecha: '2027-01-01' }, porCct('21ZZZ0201A'), { ahora: T0 }), /futura/);
  assert.equal(crearReporteEscuela({ dano: 'leve', origen: 'satelite', estado: 'raro' }, porCct('21ZZZ0201A')).origen, 'manual');
  const v = cambiarEstadoReporte(r, 'verificado', { nota: 'Revisado por Protección Civil' });
  assert.deepEqual([v.estado, v.historial.map((h) => h.accion), v.historial[1].nota], ['verificado', ['creado', 'verificado'], 'Revisado por Protección Civil']);
  assert.match(v.nota, /\(verificado\)/);
  assert.throws(() => cambiarEstadoReporte(r, 'listo'), /Estado inválido/);
});

test('reportes: manda el daño más grave verificado; si solo hay pendientes, queda por verificar', () => {
  assert.equal(estadoDano([]), null);
  const soloPend = estadoDano([rep('21ZZZ0201A', 'leve'), rep('21ZZZ0201A', 'grave')]);
  assert.deepEqual([soloPend.dano, soloPend.verificado, soloPend.porVerificar, soloPend.afectada, soloPend.pendientes], ['grave', false, true, true, 2]);
  const mixto = estadoDano([rep('21ZZZ0201A', 'inhabitable'), rep('21ZZZ0201A', 'leve', 'verificado')]);
  assert.deepEqual([mixto.dano, mixto.verificado, mixto.porVerificar, mixto.pendientes], ['leve', true, false, 1], 'el pendiente más grave no gana al verificado');
  const sinDano = estadoDano([rep('21ZZZ0201A', 'sin_dano', 'verificado')]);
  assert.equal(sinDano.afectada, false, 'sin daño no es afectada');
  const empate = estadoDano([rep('21ZZZ0201A', 'grave', 'verificado', '2026-11-01'), rep('21ZZZ0202B', 'grave', 'verificado', '2026-11-10')]);
  assert.equal(empate.deCct, '21ZZZ0202B', 'en empate, el más reciente');
});

test('reportes: un reporte se aplica a todas las CCT del mismo inmueble, diciendo de cuál vino', () => {
  const reportes = [rep('21ZZZ0201A', 'grave', 'verificado')];
  const m = danoPorEscuela(escuelas, reportes);
  assert.deepEqual([...m.keys()].sort(), ['21ZZZ0201A', '21ZZZ0202B']);
  assert.deepEqual([m.get('21ZZZ0202B').dano, m.get('21ZZZ0202B').deCct, m.get('21ZZZ0202B').propio], ['grave', '21ZZZ0201A', false]);
  assert.equal(m.get('21ZZZ0201A').propio, true);
  assert.equal(m.has('21ZZZ0203C'), false, 'otro domicilio en la misma coordenada no se contagia');
  const inm = new Map(escuelas.map((e) => [e.id, e.inmueble_id]));
  const lista = reportesDeEscuela(porCct('21ZZZ0202B'), reportes, (r) => inm.get(r.escuela_id));
  assert.deepEqual(lista.map((r) => [r.deCct, r.propio]), [['21ZZZ0201A', false]]);
});

test('trama: campo opcional CCT o CCT:daño sin romper el formato anterior', () => {
  const vieja = parsearTrama('R|Esc Primaria|3||19.04|-98.41|ag,am|Techo danado');
  assert.equal(vieja.cct, undefined);
  assert.equal(vieja.nota, 'Techo danado');
  const conCct = parsearTrama('R|Brigada 3|12||19.0412|-98.4123|me|21zzz0201a:gr|Techo caído');
  assert.deepEqual([conCct.cct, conCct.dano, conCct.nota, conCct.necesidades], ['21ZZZ0201A', 'gr', 'Techo caído', ['medicinas']]);
  const soloCct = parsearTrama('A|Albergue Escuela|40|100|19.05|-98.6|ag|21ZZZ0201A');
  assert.deepEqual([soloCct.cct, soloCct.dano, soloCct.nota], ['21ZZZ0201A', undefined, undefined]);
});

// ---------- API ----------
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nexo-rep-api-'));
for (const d of ['iter', 'cache', 'escuelas']) fs.mkdirSync(path.join(tmp, d));
fs.copyFileSync(path.join(DIR, 'fixture/iter/iter_prueba.csv'), path.join(tmp, 'iter/iter_prueba.csv'));
fs.writeFileSync(path.join(tmp, 'escuelas/escuelas.csv'), CSV);
// Catálogo sísmico vacío en caché para no salir a internet.
fs.writeFileSync(path.join(tmp, 'cache', 'usgs_1980-01-01_4.5.json'), JSON.stringify({ fuente: 'prueba', desde: '1980-01-01', magMin: 4.5, eventos: [] }));
process.env.NEXO_DATA = tmp;
process.env.PORT = '0';
delete process.env.PIANI_CLAVE;
const { iniciar, servidor } = await import('../server.js');
await iniciar(); // carga el censo de prueba
const base = `http://127.0.0.1:${servidor.address().port}`;
const pedir = (p, metodo = 'GET', b) => fetch(base + p, { method: metodo, headers: { 'content-type': 'application/json' }, body: b === undefined ? undefined : typeof b === 'string' ? b : JSON.stringify(b) })
  .then(async (r) => ({ s: r.status, j: await r.json() }));
test.after(() => servidor.close());
const filasDe = (j) => j.datos.map((d) => Object.fromEntries(j.columnas.map((c, i) => [c, d[i]])));

test('API reportes: alta, por verificar, mismo inmueble, verificación e historial', async () => {
  const alta = await pedir('/api/escuelas/21ZZZ0201A/reportes', 'POST', { dano: 'grave', descripcion: 'Grieta en muro de prueba' });
  assert.equal(alta.s, 201);
  assert.deepEqual([alta.j.estado, alta.j.origen], ['pendiente', 'manual']);

  let lista = filasDe((await pedir('/api/escuelas?fenomeno=volcanico&mes=11&estado=afectada')).j);
  assert.deepEqual(lista.map((f) => [f.cct, f.dano, f.danoVerificado, f.danoDeCct]), [
    ['21ZZZ0201A', 'grave', false, '21ZZZ0201A'],
    ['21ZZZ0202B', 'grave', false, '21ZZZ0201A'],
  ]);

  const deB = await pedir('/api/escuelas/21ZZZ0202B/reportes');
  assert.equal(deB.s, 200);
  assert.deepEqual(deB.j.reportes.map((r) => [r.deCct, r.propio]), [['21ZZZ0201A', false]]);
  assert.equal(deB.j.dano.porVerificar, true);

  // Un verificado leve manda sobre el pendiente grave…
  await pedir('/api/escuelas/21ZZZ0202B/reportes', 'POST', { dano: 'leve', estado: 'verificado' });
  lista = filasDe((await pedir('/api/escuelas?estado=afectada')).j);
  assert.deepEqual(lista.map((f) => [f.cct, f.dano, f.danoVerificado]), [['21ZZZ0201A', 'leve', true], ['21ZZZ0202B', 'leve', true]]);
  // …hasta que se verifica el grave.
  const ver = await pedir(`/api/escuelas/21ZZZ0202B/reportes/${alta.j.id}`, 'PATCH', { estado: 'verificado', nota: 'Visita de prueba' });
  assert.equal(ver.s, 200);
  const ficha = (await pedir('/api/escuela/21ZZZ0202B?fenomeno=volcanico&mes=11')).j;
  assert.deepEqual([ficha.afectada, ficha.dano.dano, ficha.dano.verificado, ficha.dano.deCct], [true, 'grave', true, '21ZZZ0201A']);
  assert.equal(ficha.reportes.length, 2);
  assert.deepEqual(ficha.historial.map((h) => h.accion), ['verificado', 'creado', 'creado']);
  assert.equal(ficha.mismoInmueble.map((x) => x.cct).join(), '21ZZZ0201A');
  assert.ok(ficha.avisos.some((a) => /Otras 1 CCT con otro domicilio/.test(a)));

  const r = (await pedir('/api/escuelas/resumen?fenomeno=volcanico&mes=11')).j;
  assert.deepEqual([r.afectadas, r.inmueblesAfectados, r.total, r.inmuebles], [2, 1, 4, 3]);
  assert.match(r.texto, /2 afectadas en 1 inmuebles/);
  assert.equal(filasDe((await pedir('/api/escuelas?estado=afectada')).j).some((f) => f.cct === '21ZZZ0203C'), false);
});

test('API reportes: errores', async () => {
  assert.equal((await pedir('/api/escuelas/21ZZZ0201A/reportes', 'POST', { dano: 'regular' })).s, 400);
  assert.equal((await pedir('/api/escuelas/21ZZZ9999Z/reportes', 'POST', { dano: 'leve' })).s, 404);
  assert.equal((await pedir('/api/escuelas/21ZZZ0201A/reportes/no-existe', 'PATCH', { estado: 'verificado' })).s, 404);
  const otro = await pedir('/api/escuelas/21ZZZ0203C/reportes', 'POST', { dano: 'leve' });
  assert.equal((await pedir(`/api/escuelas/21ZZZ0201A/reportes/${otro.j.id}`, 'PATCH', { estado: 'verificado' })).s, 404, 'reporte de otro inmueble');
  const conf = await pedir('/api/confirmaciones', 'POST', { tipo: 'escuela', nombre: 'x', lat: 19, lon: -98, personas: 0 });
  assert.equal(conf.s, 400, 'los daños en escuelas no entran por /api/confirmaciones');
});

test('API trama: CCT:daño crea un reporte de escuela pendiente con el origen del nodo', async () => {
  const t = await pedir('/api/lora/trama', 'POST', { trama: 'R|Brigada prueba|0||18.5|-97.5|me|21ZZZ0204D:in|Muro caído', via: 'espnow' });
  assert.equal(t.s, 201);
  assert.equal(t.j.cct, '21ZZZ0204D');
  assert.deepEqual([t.j.reporteEscuela.dano, t.j.reporteEscuela.origen, t.j.reporteEscuela.estado, t.j.reporteEscuela.descripcion], ['inhabitable', 'espnow', 'pendiente', 'Muro caído']);
  const f = (await pedir('/api/escuela/21ZZZ0204D')).j;
  assert.deepEqual([f.afectada, f.dano.dano, f.dano.porVerificar, f.dano.origen], [true, 'inhabitable', true, 'espnow']);

  const desconocida = await pedir('/api/lora/trama', 'POST', 'R|Brigada prueba|0||18.5|-97.5||21ZZZ9999Z:gr');
  assert.equal(desconocida.j.reporteEscuela, undefined);
  assert.match(desconocida.j.nota, /CCT 21ZZZ9999Z no está en el catálogo/);
  const vieja = await pedir('/api/lora/trama', 'POST', 'R|Brigada prueba|2||18.5|-97.5|ag|Sin escuela');
  assert.deepEqual([vieja.s, vieja.j.cct, vieja.j.reporteEscuela], [201, undefined, undefined]);
});
