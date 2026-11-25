// Escuelas: lector de data/escuelas/*.csv (Catálogo CCT de la SEP y DENUE del INEGI).
// Usa test/fixture/escuelas/, con escuelas, claves CCT (21ZZZ…), coordenadas y matrículas
// INVENTADAS solo para probar el código: no corresponden a ninguna escuela real.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  procesarEscuelas, cargarEscuelasDesdeCarpeta, normalizarNivel, normalizarSostenimiento, decimalesCoord, dentroDePuebla, claveEntidad,
  limpio, limpiarTurno, armarDomicilio,
} from '../lib/escuelas.js';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const SEP = path.join(DIR, 'fixture/escuelas/escuelas_prueba.csv');
const DENUE = path.join(DIR, 'fixture/escuelas/denue_prueba.csv');
const CNCT = path.join(DIR, 'fixture/escuelas/cnct_prueba.csv'); // mismo encabezado que cnct2026.csv de la SEP
const PRUEBA = 'DATOS DE PRUEBA (inventados solo para probar el código)';
const leer = (f) => procesarEscuelas(fs.readFileSync(f, 'utf8'), path.basename(f));

// ---------- Lector ----------
test('escuelas: lee el catálogo SEP y normaliza los campos', () => {
  const { escuelas } = leer(SEP);
  const [uno, dos, tres] = escuelas;
  assert.deepEqual(uno, {
    id: '21ZZZ0001A', cct: '21ZZZ0001A', nombre: 'Escuela de prueba Uno, turno matutino', tipo_ct: '', es_inmueble_escolar: true,
    nivel: 'primaria', nivel_origen: 'nivel', servicion1: '', servicion2: '', servicion3: '',
    sostenimiento: 'Público', subcontrol: '', municipio: 'Municipio A', localidad: 'Localidad Dos', ambito: '', domicilio: '',
    lat: 19.1667, lon: -98.3333, alumnos: 320, turnos: ['MATUTINO'], turnos_inactivos: [], fuente: PRUEBA,
    decimales_coord: 'alta', ubicacion_aproximada: false,
  });
  assert.equal(dos.alumnos, null, 'alumnos vacío = null, no 0');
  assert.equal(dos.sostenimiento, 'Privado');
  assert.equal(dos.decimales_coord, 'baja');
  assert.equal(dos.ubicacion_aproximada, true);
  assert.equal(tres.cct, '21ZZZ0003C', 'CCT con espacios y minúsculas');
  assert.equal(tres.nivel, 'secundaria', 'Telesecundaria → secundaria');
  assert.equal(tres.lat, 18.501528, 'grados-minutos-segundos a decimal');
  assert.equal(tres.lon, -97.502833);
  assert.equal(escuelas.at(-1).cct, '21ZZZ0009J', 'entidad escrita como "Puebla" también cuenta');
});

test('escuelas: filtra por entidad 21 y cuenta aparte cada motivo de descarte', () => {
  const { resumen, descartes } = leer(SEP);
  assert.deepEqual(resumen, {
    filas: 12, validas: 8, otraEntidad: 1, noEscolares: 0, cctInvalido: 1, sinCoordenadas: 1, coordCero: 0, coordFueraDePuebla: 1,
    cctNoCoincide: 0, tiposDescartados: {},
  });
  assert.deepEqual(descartes.map((d) => [d.fila, d.cct, d.motivo]), [
    [5, '15ZZZ0004D', 'entidad 15, no Puebla (21)'],
    [6, '21ZZZ0005E', 'coordenadas fuera de Puebla (19.4326, -99.1332)'],
    [7, '21ZZZ0006F', 'sin coordenadas'],
    [12, '21ZZ00081H', 'El CCT no tiene el formato esperado, por ejemplo 21DPR1273G.'],
  ]);
  assert.equal(dentroDePuebla(19.04, -98.2), true);
  assert.equal(dentroDePuebla(19.4326, -99.1332), false);
  assert.equal(claveEntidad('21'), '21');
  assert.equal(claveEntidad('21.0'), '21');
  assert.equal(claveEntidad('Puebla'), '21');
  assert.equal(claveEntidad('7'), '07');
  assert.equal(claveEntidad(''), null);
});

test('escuelas: informa columnas reconocidas, no reconocidas y si hay latitud y longitud', () => {
  const { columnas } = leer(SEP);
  assert.equal(columnas.formato, 'SEP');
  assert.deepEqual(columnas.noReconocidas, ['COLUMNA_EXTRA']);
  assert.equal(columnas.reconocidas.cct, 'CLAVE_CT');
  assert.equal(columnas.reconocidas.entidad, 'CVE_ENT');
  assert.equal(columnas.entidad, 'clave');
  assert.equal(columnas.latLon, true);
  assert.equal(columnas.turno, true);
  assert.deepEqual(leer(DENUE).columnas.noReconocidas, ['raz_social', 'per_ocu', 'entidad'], 'entidad se toma de cve_ent');
});

test('escuelas: DENUE sin CCT ni alumnos, solo actividades escolares de la entidad 21', () => {
  const { escuelas, resumen, formato } = leer(DENUE);
  assert.equal(formato, 'DENUE');
  assert.equal(resumen.noEscolares, 1, 'la tienda (461110) no es escuela');
  assert.equal(resumen.otraEntidad, 1, 'la de Tlaxcala (29)');
  assert.deepEqual(escuelas.map((e) => [e.id, e.cct, e.nivel, e.sostenimiento, e.alumnos, e.turnos, e.fuente, e.decimales_coord]), [
    ['DENUE-900001', '', 'primaria', 'Público', null, [], 'DENUE (INEGI)', 'alta'],
    ['DENUE-900002', '', 'preescolar', 'Privado', null, [], 'DENUE (INEGI)', 'media'],
  ]);
});

test('escuelas: faltan columnas o archivo vacío', () => {
  assert.throws(() => procesarEscuelas('nombre,lat\nX,19', 'malo.csv'), /malo\.csv: faltan columnas: cct, lon/);
  assert.throws(() => procesarEscuelas('cct,nombre,lat,lon', 'vacio.csv'), /vacío/);
});

test('escuelas: un registro por CCT, suma alumnos de todos los turnos y separa los repetidos', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexo-esc-'));
  assert.equal(cargarEscuelasDesdeCarpeta(path.join(dir, 'no-existe')), null);
  assert.equal(cargarEscuelasDesdeCarpeta(dir), null, 'carpeta sin CSV');
  fs.copyFileSync(SEP, path.join(dir, 'a_sep.csv'));
  fs.copyFileSync(DENUE, path.join(dir, 'b_denue.csv'));
  fs.writeFileSync(path.join(dir, 'c_malo.csv'), 'hola,mundo\n1,2\n');
  const r = cargarEscuelasDesdeCarpeta(dir);
  assert.equal(r.escuelas.length, 7);
  const uno = r.escuelas.find((e) => e.cct === '21ZZZ0001A');
  assert.deepEqual([uno.alumnos, uno.turnos, uno.alumnos_incompleto], [470, ['MATUTINO', 'VESPERTINO'], undefined], '320 + 150; el renglón repetido no suma');
  const siete = r.escuelas.find((e) => e.cct === '21ZZZ0007G');
  assert.deepEqual([siete.alumnos, siete.alumnos_incompleto], [80, true], 'un turno sin matrícula: la suma es un mínimo');
  assert.equal(r.escuelas.find((e) => e.cct === '21ZZZ0002B').alumnos, null);
  assert.equal(r.resumen.turnosUnidos, 2);
  assert.equal(r.resumen.repetidas, 1);
  assert.deepEqual(r.resumen.porFuente, { [PRUEBA]: 5, 'DENUE (INEGI)': 2 });
  assert.equal(r.resumen.filas, 16);
  assert.equal(r.resumen.otraEntidad, 2);
  assert.deepEqual(r.resumen.archivos.map((a) => [a.formato, a.latLon, a.entidad]), [['SEP', true, 'clave'], ['DENUE', true, 'clave']]);
  assert.equal(r.errores.length, 1);
  assert.match(r.errores[0], /c_malo\.csv: faltan columnas/);
});

// ---------- Catálogo Nacional de Centros de Trabajo (CNCT) de la SEP ----------
test('CNCT: reconoce las columnas reales y normaliza el registro', () => {
  const { escuelas, columnas } = leer(CNCT);
  assert.equal(columnas.formato, 'SEP (CNCT)');
  assert.equal(columnas.entidad, 'nombre', 'no trae cve_ent: filtra por inmueble_c_nom_ent');
  assert.equal(columnas.alumnos, false);
  assert.deepEqual(
    [columnas.reconocidas.cct, columnas.reconocidas.nombre, columnas.reconocidas.lat, columnas.reconocidas.lon, columnas.reconocidas.entidad_nombre],
    ['cv_cct', 'c_nombre', 'inmueble_latitud', 'inmueble_longitud', 'inmueble_c_nom_ent'],
  );
  assert.ok(columnas.noReconocidas.includes('c_administrativa'));
  assert.ok(columnas.noReconocidas.includes('supervision_cv_cct'));
  assert.deepEqual(escuelas[0], {
    id: '21ZZZ0101A', cct: '21ZZZ0101A', nombre: 'Primaria de Prueba (dato inventado)', tipo_ct: 'escuela', es_inmueble_escolar: true,
    nivel: 'primaria', nivel_origen: 'servicion', servicion1: 'básica', servicion2: 'primaria', servicion3: 'general',
    sostenimiento: 'Público', subcontrol: 'Federal', municipio: 'Municipio A', localidad: 'Localidad Dos',
    ambito: 'urbano', domicilio: 'Calle de Prueba 12, Colonia de Prueba, C.P. 72000', lat: 19.1667, lon: -98.3333,
    alumnos: null, turnos: ['matutino', 'vespertino'], turnos_inactivos: [], fuente: 'Catálogo CCT (SEP)',
    decimales_coord: 'alta', ubicacion_aproximada: false,
  });
  const bach = escuelas[1];
  assert.deepEqual([bach.tipo_ct, bach.servicion1, bach.servicion2, bach.servicion3], ['plantel (media superior)', '', '', ''], '"Sin Dato" queda vacío');
  assert.deepEqual([bach.nivel, bach.nivel_origen], ['media superior', 'c_tipo'], 'el nivel sale del tipo de centro');
  assert.deepEqual([bach.turnos, bach.domicilio, bach.ambito, bach.subcontrol], [['discontinuo'], 'Calle de Prueba, Colonia de Prueba', 'rural', 'Estatal'], 'número y CP en 0 no se escriben');
  assert.ok(escuelas.every((e) => e.alumnos === null), 'el CNCT no trae alumnos: no se inventan');
});

test('CNCT: albergue escolar y CONAFE entran; turnos inactivos aparte; ubicación aproximada', () => {
  const { escuelas } = leer(CNCT);
  const alb = escuelas.find((e) => e.cct === '21ZZZ0111L');
  assert.deepEqual([alb.tipo_ct, alb.es_inmueble_escolar, alb.nivel, alb.nivel_origen], ['asistencial', true, '', ''], 'albergue escolar sin nivel');
  assert.deepEqual([alb.decimales_coord, alb.ubicacion_aproximada], ['baja', true]);
  const conafe = escuelas.find((e) => e.cct === '21ZZZ0112M');
  assert.equal(conafe.es_inmueble_escolar, false, 'CONAFE puede funcionar en una casa');
  assert.deepEqual([conafe.nivel, conafe.nivel_origen], ['inicial', 'c_tipo']);
  assert.deepEqual([conafe.turnos, conafe.turnos_inactivos], [['matutino'], ['vespertino']]);
});

test('CNCT: filtra Puebla por nombre, solo planteles, y cuenta cada descarte con su CCT', () => {
  const { escuelas, resumen, descartes } = leer(CNCT);
  assert.deepEqual(escuelas.map((e) => e.cct), ['21ZZZ0101A', '21ZZZ0102B', '15ZZZ0108H', '21ZZZ0109J', '21ZZZ0111L', '21ZZZ0112M'], '"PUEBLA" en mayúsculas también cuenta');
  assert.deepEqual(resumen, {
    filas: 12, validas: 6, otraEntidad: 1, noEscolares: 2, cctInvalido: 0, sinCoordenadas: 1, coordCero: 1, coordFueraDePuebla: 1,
    cctNoCoincide: 1, tiposDescartados: { administrativo: 1, biblioteca: 1 },
  });
  assert.deepEqual(descartes.map((d) => [d.fila, d.cct, d.motivo]), [
    [4, '21ZZZ0103C', 'c_tipo "administrativo" no es plantel'],
    [5, '21ZZZ0104D', 'c_tipo "biblioteca" no es plantel'],
    [6, '01ZZZ0105E', 'entidad Aguascalientes, no Puebla'],
    [7, '21ZZZ0106F', 'coordenada en 0 (0, 0)'],
    [8, '21ZZZ0107G', 'coordenadas fuera de Puebla (21.8830, -102.2763)'],
    [11, '21ZZZ0110K', 'sin coordenadas'],
  ]);
});

test('CNCT: limpieza de "sin dato", turnos y domicilio', () => {
  assert.equal(limpio('Sin Dato'), '');
  assert.equal(limpio(' sin dato '), '');
  assert.equal(limpio('San  Pedro'), 'San Pedro');
  assert.equal(limpiarTurno('1 - matutino'), 'matutino');
  assert.equal(limpiarTurno('2 - vespertino (inactivo)'), 'vespertino (inactivo)');
  assert.equal(limpiarTurno('sin dato'), '');
  assert.equal(armarDomicilio({ vialidad: 'Calle 5', num_ext: '0', asentamiento: 'Centro', cp: '7200' }), 'Calle 5, Centro, C.P. 07200');
  assert.equal(armarDomicilio({ vialidad: 'Sin Dato', num_ext: '', asentamiento: 'sin dato', cp: '0' }), '');
});

test('escuelas: nivel, sostenimiento y decimales de la coordenada', () => {
  assert.equal(normalizarNivel('Escuelas del sector público que combinan diversos niveles de educación'), '', 'no se reconoce: vacío');
  assert.equal(normalizarNivel('Escuelas de educación superior del sector privado'), 'superior');
  assert.equal(normalizarNivel('cam'), 'especial');
  assert.equal(normalizarNivel('formación para el trabajo'), 'formación para el trabajo');
  assert.equal(normalizarNivel('capacitación'), 'formación para el trabajo');
  assert.equal(normalizarNivel('lactante y maternal'), 'inicial');
  assert.equal(normalizarNivel('profesional técnico bachiller'), 'media superior');
  assert.equal(normalizarSostenimiento('Escuelas ... del sector privado'), 'Privado');
  assert.equal(normalizarSostenimiento(''), '');
  assert.equal(decimalesCoord('19.12345', '-98.1234'), 'alta');
  assert.equal(decimalesCoord('19.123', '-98.12345'), 'media', 'manda la menos fina');
  assert.equal(decimalesCoord('19', '-98.1'), 'baja');
  assert.equal(decimalesCoord('19°01\'02" N', '98°01\'02" W'), 'media', 'segundos enteros ≈ 30 m');
});

// ---------- Servidor ----------
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nexo-esc-api-'));
process.env.NEXO_DATA = tmp; // sin censo ni escuelas
process.env.PORT = '0';
const { servidor } = await import('../server.js');
await new Promise((r) => servidor.listen(0, r));
const base = `http://127.0.0.1:${servidor.address().port}`;
const get = (p) => fetch(base + p).then(async (r) => ({ s: r.status, j: await r.json() }));
test.after(() => servidor.close());

test('API escuelas: sin archivo avisa y no truena; al copiar el CSV se carga sin reiniciar', async () => {
  const sin = await get('/api/estado');
  assert.equal(sin.s, 200);
  assert.equal(sin.j.escuelas.cargadas, false);
  assert.match(sin.j.escuelas.aviso, /data\/escuelas/);

  fs.mkdirSync(path.join(tmp, 'escuelas'));
  fs.copyFileSync(SEP, path.join(tmp, 'escuelas', 'escuelas_prueba.csv'));
  const con = await get('/api/estado');
  assert.equal(con.j.escuelas.cargadas, true);
  assert.equal(con.j.escuelas.total, 5, '8 renglones válidos = 5 CCT (2 turnos unidos y 1 repetido)');
  assert.equal(con.j.escuelas.resumen.coordFueraDePuebla, 1);
  assert.deepEqual(con.j.escuelas.resumen.archivos[0].noReconocidas, ['COLUMNA_EXTRA']);
  assert.equal(con.j.escuelas.aviso, null);
});
