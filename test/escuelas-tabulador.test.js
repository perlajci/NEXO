// Escuelas en Tabulador y Reportes (paso 6): escuelas prioritarias por inmueble, foto de la escuela en
// el presupuesto, CSV de presupuesto y de reportes. Escuelas, CCT (21ZZZ…), alumnos, coordenadas y
// precios INVENTADOS solo para probar el código.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { grupoDe, priorizarInmuebles, contextoEscuela, filasEscuelaCSV, reportesACSV, textoEscenario } from '../lib/prioridades-escuelas.js';
import { crearIndiceLocalidades } from '../lib/riesgo-escuelas.js';
import { distanciaKm } from '../lib/geo.js';

const DIR = path.dirname(fileURLToPath(import.meta.url));

// ---------- Unidades ----------
test('prioridades: grupos en el orden pedido', () => {
  assert.equal(grupoDe({ afectada: true, dano: 'inhabitable', nivel: 'bajo' }), 1);
  assert.equal(grupoDe({ afectada: true, dano: 'grave', nivel: 'muy_alto' }), 1);
  assert.equal(grupoDe({ afectada: true, dano: 'moderado', nivel: 'muy_alto' }), 2, 'afectada manda sobre en peligro');
  assert.equal(grupoDe({ afectada: true, dano: 'leve' }), 2);
  assert.equal(grupoDe({ afectada: false, nivel: 'muy_alto' }), 3);
  assert.equal(grupoDe({ afectada: false, nivel: 'alto' }), 4);
  assert.equal(grupoDe({ afectada: false, nivel: 'medio' }), null);
});

const filaEsc = (o) => ({
  e: { id: o.cct, cct: o.cct, nombre: o.nombre || `Escuela ${o.cct}`, nivel: 'primaria', municipio: 'Municipio A', localidad: 'Localidad', domicilio: 'Calle', lat: 19, lon: -98, alumnos: o.alumnos ?? null, inmueble_id: o.inm || o.cct, es_inmueble_escolar: o.escolar ?? true },
  riesgo: { nivel: o.nivel || 'bajo' }, afectada: !!o.dano && o.dano !== 'sin_dano', dano: o.dano ? { dano: o.dano, verificado: o.verificado ?? false, deCct: o.cct } : null, pob2km: o.pob ?? 0,
});

test('prioridades: por inmueble, grupo, alumnos (o población a 2 km) y si ya tiene presupuesto', () => {
  const filas = [
    filaEsc({ cct: '21ZZZ0001A', inm: 'I1', nivel: 'muy_alto', alumnos: 100 }),
    filaEsc({ cct: '21ZZZ0002B', inm: 'I1', nivel: 'muy_alto', alumnos: 50 }), // mismo inmueble: 150 alumnos
    filaEsc({ cct: '21ZZZ0003C', inm: 'I2', nivel: 'muy_alto', alumnos: 300 }),
    filaEsc({ cct: '21ZZZ0004D', inm: 'I3', nivel: 'muy_alto', pob: 9000 }), // sin alumnos: va después de los que sí tienen
    filaEsc({ cct: '21ZZZ0005E', inm: 'I4', nivel: 'alto', pob: 100 }),
    filaEsc({ cct: '21ZZZ0006F', inm: 'I5', nivel: 'alto', pob: 5000 }),
    filaEsc({ cct: '21ZZZ0007G', inm: 'I6', nivel: 'medio', dano: 'leve' }),
    filaEsc({ cct: '21ZZZ0008H', inm: 'I7', nivel: 'bajo', dano: 'inhabitable', verificado: true }),
    filaEsc({ cct: '21ZZZ0009J', inm: 'I8', nivel: 'medio' }), // ni afectada ni en peligro: no entra
    filaEsc({ cct: '21ZZZ0010K', inm: 'I9', nivel: 'muy_alto', escolar: false, alumnos: 999 }), // CONAFE
    filaEsc({ cct: '21ZZZ0011L', inm: 'I10', nivel: 'alto', dano: 'sin_dano', verificado: true, pob: 1 }), // sin daño: cuenta por riesgo
  ];
  const r = priorizarInmuebles(filas, [{ id: 'p1', cct: '21ZZZ0002B', obra: 'Obra', fecha: '2026-11-25', total: 10 }]);
  assert.deepEqual(r.inmuebles.map((x) => [x.inmueble_id, x.grupo]), [
    ['I7', 1], ['I6', 2], ['I2', 3], ['I1', 3], ['I3', 3], ['I5', 4], ['I4', 4], ['I10', 4],
  ]);
  const i1 = r.inmuebles.find((x) => x.inmueble_id === 'I1');
  assert.deepEqual([i1.escuelas.map((e) => e.cct), i1.alumnos, i1.ordenadoPor, i1.tienePresupuesto, i1.presupuestos[0].id], [['21ZZZ0001A', '21ZZZ0002B'], 150, 'alumnos', true, 'p1']);
  assert.deepEqual([r.inmuebles.find((x) => x.inmueble_id === 'I3').ordenadoPor, r.inmuebles.find((x) => x.inmueble_id === 'I2').tienePresupuesto], ['pob2km', false]);
  assert.deepEqual(r.porGrupo, { 1: 1, 2: 1, 3: 3, 4: 3 });
  assert.deepEqual([r.total, r.sinInmuebleEscolar, r.conPresupuesto], [8, 1, 1]);
  const conConafe = priorizarInmuebles(filas, [], { conafe: true });
  assert.equal(conConafe.inmuebles[2].inmueble_id, 'I9', 'con la opción, el CONAFE entra (999 alumnos)');
});

test('presupuesto: foto de la escuela y sus renglones en el CSV', () => {
  const f = {
    e: { id: '21ZZZ0001A', cct: '21ZZZ0001A', nombre: 'Primaria de prueba', nivel: 'primaria', municipio: 'M', localidad: 'L', inmueble_id: 'I1', lat: 19.05, lon: -98.6, fuente: 'Catálogo CCT (SEP)', fuente_coord: 'manual', decimales_coord: 'alta' },
    riesgo: { nivel: 'muy_alto', r: 0.75, p: 1, V: null }, enPeligro: true,
    dano: { dano: 'grave', verificado: false, origen: 'espnow', deCct: '21ZZZ0002B', fecha_dano: '2026-11-20T00:00:00.000Z' },
  };
  const c = contextoEscuela(f, 'lluvias', 7);
  assert.deepEqual([c.fuente_coord, c.mes, c.riesgo.nivel, c.dano.origen], ['manual', 7, 'muy_alto', 'espnow']);
  assert.equal(contextoEscuela(f, 'volcanico', 7).mes, null, 'volcánico no depende del mes');
  assert.equal(textoEscenario('lluvias', 7), 'Lluvias intensas / inundación, julio');
  assert.deepEqual(filasEscuelaCSV(c), [
    'Escuela,Primaria de prueba',
    'Latitud,19.05',
    'Longitud,-98.6',
    'Fuente de la coordenada,manual',
    'Nivel de riesgo,Muy alto (índice 0.75)',
    'Fenómeno y mes usados,"Lluvias intensas / inundación, julio"',
    'Estado de daño,Grave (por verificar)',
    'Origen del reporte de daño,"espnow (reportado en 21ZZZ0002B, mismo inmueble)"',
  ]);
  assert.match(filasEscuelaCSV(null)[0], /^Escuela,Sin datos de la escuela/);
});

test('índice: localidades a 2 km, igual que recorriéndolas todas', () => {
  const locs = Array.from({ length: 500 }, (_, i) => ({ id: i, lat: 19 + ((i * 37) % 100) / 1000, lon: -98 + ((i * 53) % 100) / 1000 }));
  const idx = crearIndiceLocalidades(locs);
  for (const [lat, lon] of [[19.05, -97.95], [19.0, -98.0], [19.099, -97.901]]) {
    const bruto = locs.filter((l) => distanciaKm(lat, lon, l.lat, l.lon) <= 2).map((l) => l.id).sort((a, b) => a - b);
    assert.deepEqual(idx.dentroDe(lat, lon, 2).map((l) => l.id).sort((a, b) => a - b), bruto);
  }
});

// ---------- API ----------
const CSV = `cct,nombre,nivel,latitud,longitud,vialidad,colonia,alumnos
21ZZZ0401A,Primaria de prueba A (dato inventado),primaria,19.058333,-98.608333,Calle Uno 1,Centro,100
21ZZZ0402B,Secundaria de prueba A (dato inventado),secundaria,19.058333,-98.608333,Calle Uno,Centro,50
21ZZZ0403C,Primaria de prueba B (dato inventado),primaria,19.06,-98.61,Calle Dos,Centro,300
21ZZZ0404D,Preescolar de prueba C (dato inventado),preescolar,19.166667,-98.333333,Calle Tres,Centro,40
21ZZZ0405E,Primaria de prueba D (dato inventado),primaria,18.5,-97.5,Calle Cuatro,Centro,20
`;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nexo-esc-tab-'));
for (const d of ['iter', 'cache', 'escuelas', 'capcee']) fs.mkdirSync(path.join(tmp, d));
fs.copyFileSync(path.join(DIR, 'fixture/iter/iter_prueba.csv'), path.join(tmp, 'iter/iter_prueba.csv'));
fs.copyFileSync(path.join(DIR, 'fixture/capcee/tabulador_prueba.csv'), path.join(tmp, 'capcee/tabulador.csv'));
fs.writeFileSync(path.join(tmp, 'escuelas/e.csv'), CSV);
fs.writeFileSync(path.join(tmp, 'cache', 'usgs_1980-01-01_4.5.json'), JSON.stringify({ fuente: 'prueba', desde: '1980-01-01', magMin: 4.5, eventos: [] }));
process.env.NEXO_DATA = tmp;
process.env.PORT = '0';
delete process.env.PIANI_CLAVE;
const { iniciar, servidor } = await import('../server.js');
await iniciar();
const base = `http://127.0.0.1:${servidor.address().port}`;
const pedir = (p, metodo = 'GET', b) => fetch(base + p, { method: metodo, headers: { 'content-type': 'application/json' }, body: b === undefined ? undefined : JSON.stringify(b) })
  .then(async (r) => ({ s: r.status, j: await r.json() }));
const texto = (p) => fetch(base + p).then(async (r) => ({ s: r.status, h: r.headers, t: Buffer.from(await r.arrayBuffer()) }));
test.after(() => servidor.close());

test('API: escuelas prioritarias por inmueble, con presupuesto o sin él', async () => {
  await pedir('/api/escuelas/21ZZZ0405E/reportes', 'POST', { dano: 'grave', estado: 'verificado' });
  await pedir('/api/escuelas/21ZZZ0404D/reportes', 'POST', { dano: 'leve', origen: 'lora' });
  let r = (await pedir('/api/escuelas/prioritarias?fenomeno=volcanico&mes=11')).j;
  assert.deepEqual(r.inmuebles.map((x) => [x.escuelas.map((e) => e.cct).join('+'), x.grupo, x.alumnos]), [
    ['21ZZZ0405E', 1, 20],
    ['21ZZZ0404D', 2, 40],
    ['21ZZZ0403C', 3, 300],
    ['21ZZZ0401A+21ZZZ0402B', 3, 150],
  ]);
  assert.equal(r.conPresupuesto, 0);
  const pres = await pedir('/api/presupuestos', 'POST', { obra: 'Rehabilitación de prueba', cct: '21ZZZ0402B', fenomeno: 'volcanico', mes: 11, renglones: [{ clave_ref: 'PRUEBA-001', cantidad: 2 }] });
  assert.equal(pres.s, 201);
  r = (await pedir('/api/escuelas/prioritarias?fenomeno=volcanico&mes=11')).j;
  const inm = r.inmuebles.find((x) => x.escuelas.some((e) => e.cct === '21ZZZ0401A'));
  assert.deepEqual([inm.tienePresupuesto, inm.presupuestos[0].id], [true, pres.j.id], 'un presupuesto en cualquier CCT del inmueble cuenta');
  assert.equal((await pedir('/api/escuelas/prioritarias?limite=1&desde=1')).j.inmuebles[0].escuelas[0].cct, '21ZZZ0404D');
});

test('API: el presupuesto guarda la foto de la escuela y la exporta a CSV', async () => {
  const p = (await pedir('/api/presupuestos', 'POST', { obra: 'Obra de prueba', cct: '21ZZZ0404D', fenomeno: 'volcanico', mes: 11, renglones: [{ clave_ref: 'PRUEBA-001', cantidad: 1 }] })).j;
  assert.equal(p.plantel.nombre, 'Preescolar de prueba C (dato inventado)', 'el plantel sale del catálogo de escuelas');
  assert.deepEqual([p.escuela.cct, p.escuela.fuente_coord, p.escuela.dano.dano, p.escuela.dano.origen, p.escuela.fenomeno], ['21ZZZ0404D', 'Catálogo CCT (SEP)', 'leve', 'lora', 'volcanico']);
  const csv = (await texto(`/api/presupuestos/${p.id}/csv`)).t.toString('utf8').slice(1).split('\r\n');
  assert.equal(csv[2], 'CCT,21ZZZ0404D', 'los renglones de siempre no se mueven');
  const i = csv.indexOf('Datos de la escuela');
  assert.ok(i > 0);
  assert.deepEqual(csv.slice(i + 1, i + 9), [
    'Escuela,Preescolar de prueba C (dato inventado)',
    'Latitud,19.166667',
    'Longitud,-98.333333',
    'Fuente de la coordenada,Catálogo CCT (SEP)',
    `Nivel de riesgo,${csv[i + 5].split(',').slice(1).join(',')}`,
    'Fenómeno y mes usados,Volcánico (Popocatépetl)',
    'Estado de daño,Leve (por verificar)',
    'Origen del reporte de daño,lora',
  ]);
  assert.match(csv[i + 5], /^Nivel de riesgo,(Bajo|Medio|Alto|Muy alto) \(índice [\d.]+\)$/);

  const sinCat = (await pedir('/api/presupuestos', 'POST', { obra: 'Obra fuera del catálogo', cct: '21DPR1273G', renglones: [{ clave_ref: 'PRUEBA-001', cantidad: 1 }] })).j;
  assert.equal(sinCat.escuela, null);
  const csv2 = (await texto(`/api/presupuestos/${sinCat.id}/csv`)).t.toString('utf8');
  assert.match(csv2, /Escuela,Sin datos de la escuela: la CCT no está en el catálogo/);
});

test('API: CSV de reportes de daño con CCT, coordenadas, fuente, riesgo, escenario, daño y origen', async () => {
  const r = await texto('/api/escuelas/reportes.csv?fenomeno=volcanico&mes=11');
  assert.equal(r.s, 200);
  assert.match(r.h.get('content-disposition'), /filename="reportes_escuelas_volcanico_\d{4}-\d{2}-\d{2}\.csv"/);
  assert.deepEqual([...r.t.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
  const L = r.t.toString('utf8').slice(1).split('\r\n');
  assert.equal(L[1], 'Fenómeno y mes usados para el riesgo,Volcánico (Popocatépetl)');
  const cab = L[4].split(',');
  for (const c of ['CCT', 'Latitud', 'Longitud', 'Fuente de la coordenada', 'Daño reportado', 'Estado del reporte', 'Origen del reporte', 'Estado de daño de la escuela', 'Nivel de riesgo', 'Fenómeno y mes usados']) {
    assert.ok(cab.includes(c), `falta la columna ${c}`);
  }
  const filas = L.slice(5).filter(Boolean).map((x) => x.split(','));
  assert.equal(filas.length, 2);
  const lora = filas.find((f) => f[cab.indexOf('CCT')] === '21ZZZ0404D');
  assert.deepEqual([lora[cab.indexOf('Daño reportado')], lora[cab.indexOf('Estado del reporte')], lora[cab.indexOf('Origen del reporte')], lora[cab.indexOf('Latitud')]], ['Leve', 'pendiente', 'lora', '19.166667']);
});
