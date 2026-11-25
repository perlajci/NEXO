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
  procesarEscuelas, cargarEscuelasDesdeCarpeta, normalizarNivel, normalizarSostenimiento, precisionCoordenada, dentroDePuebla,
} from '../lib/escuelas.js';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const SEP = path.join(DIR, 'fixture/escuelas/escuelas_prueba.csv');
const DENUE = path.join(DIR, 'fixture/escuelas/denue_prueba.csv');
const PRUEBA = 'DATOS DE PRUEBA (inventados solo para probar el código)';

// ---------- Lector ----------
test('escuelas: lee el catálogo SEP y normaliza los campos', () => {
  const { escuelas, formato } = procesarEscuelas(fs.readFileSync(SEP, 'utf8'), 'escuelas_prueba.csv');
  assert.equal(formato, 'SEP');
  const [uno, dos, tres] = escuelas;
  assert.deepEqual(uno, {
    id: '21ZZZ0001A', cct: '21ZZZ0001A', nombre: 'Escuela de prueba Uno, turno matutino', nivel: 'Primaria', sostenimiento: 'Público',
    municipio: 'Municipio A', localidad: 'Localidad Dos', lat: 19.1667, lon: -98.3333, alumnos: 320, fuente: PRUEBA, precision: 'alta',
  });
  assert.equal(dos.alumnos, null, 'alumnos vacío = null, no 0');
  assert.equal(dos.sostenimiento, 'Privado');
  assert.equal(dos.precision, 'baja');
  assert.equal(tres.cct, '21ZZZ0003C', 'CCT con espacios y minúsculas');
  assert.equal(tres.nivel, 'Secundaria');
  assert.equal(tres.lat, 18.501528, 'grados-minutos-segundos a decimal');
  assert.equal(tres.lon, -97.502833);
  assert.equal(escuelas.at(-1).nivel, 'Media superior');
});

test('escuelas: descarta y cuenta CCT inválida, fuera de Puebla y sin coordenadas', () => {
  const { resumen, descartes } = procesarEscuelas(fs.readFileSync(SEP, 'utf8'), 'escuelas_prueba.csv');
  assert.deepEqual(resumen, { filas: 8, validas: 5, fueraDePuebla: 1, sinCoordenadas: 1, cctInvalido: 1, noEscolares: 0 });
  assert.deepEqual(descartes.map((d) => d.fila), [5, 6, 7]);
  assert.match(descartes[0].motivo, /empezar con 21/);
  assert.match(descartes[1].motivo, /fuera de Puebla \(19\.4326, -99\.1332\)/);
  assert.equal(descartes[2].motivo, 'sin coordenadas');
  assert.equal(dentroDePuebla(19.04, -98.2), true);
  assert.equal(dentroDePuebla(19.4326, -99.1332), false);
});

test('escuelas: DENUE sin CCT ni alumnos, solo actividades escolares', () => {
  const { escuelas, resumen, formato } = procesarEscuelas(fs.readFileSync(DENUE, 'utf8'), 'denue_prueba.csv');
  assert.equal(formato, 'DENUE');
  assert.equal(resumen.noEscolares, 1, 'la tienda (461110) no es escuela');
  assert.deepEqual(escuelas.map((e) => [e.id, e.cct, e.nivel, e.sostenimiento, e.alumnos, e.fuente, e.precision]), [
    ['DENUE-900001', '', 'Primaria', 'Público', null, 'DENUE (INEGI)', 'alta'],
    ['DENUE-900002', '', 'Preescolar', 'Privado', null, 'DENUE (INEGI)', 'media'],
  ]);
});

test('escuelas: faltan columnas o archivo vacío', () => {
  assert.throws(() => procesarEscuelas('nombre,lat\nX,19', 'malo.csv'), /malo\.csv: faltan columnas: cct, lon/);
  assert.throws(() => procesarEscuelas('cct,nombre,lat,lon', 'vacio.csv'), /vacío/);
});

test('escuelas: carpeta con varias fuentes, repetidas y un archivo dañado', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexo-esc-'));
  assert.equal(cargarEscuelasDesdeCarpeta(path.join(dir, 'no-existe')), null);
  assert.equal(cargarEscuelasDesdeCarpeta(dir), null, 'carpeta sin CSV');
  fs.copyFileSync(SEP, path.join(dir, 'a_sep.csv'));
  fs.copyFileSync(DENUE, path.join(dir, 'b_denue.csv'));
  fs.writeFileSync(path.join(dir, 'c_malo.csv'), 'hola,mundo\n1,2\n');
  const r = cargarEscuelasDesdeCarpeta(dir);
  assert.equal(r.escuelas.length, 6);
  assert.equal(r.resumen.repetidas, 1, 'la CCT repetida se cuenta una vez');
  assert.equal(r.escuelas.find((e) => e.cct === '21ZZZ0001A').alumnos, 320, 'se queda el primer renglón');
  assert.deepEqual(r.resumen.porFuente, { [PRUEBA]: 4, 'DENUE (INEGI)': 2 });
  assert.equal(r.resumen.filas, 11);
  assert.deepEqual(r.resumen.archivos.map((a) => a.formato), ['SEP', 'DENUE']);
  assert.equal(r.errores.length, 1);
  assert.match(r.errores[0], /c_malo\.csv: faltan columnas/);
});

test('escuelas: nivel, sostenimiento y precisión', () => {
  assert.equal(normalizarNivel('Escuelas del sector público que combinan diversos niveles de educación'), 'Varios niveles');
  assert.equal(normalizarNivel('Escuelas de educación superior del sector privado'), 'Superior');
  assert.equal(normalizarNivel('CAM Educación Especial'), 'Especial');
  assert.equal(normalizarNivel('Formación para el trabajo'), 'Formación para el trabajo', 'si no se reconoce se deja igual');
  assert.equal(normalizarSostenimiento('Escuelas ... del sector privado'), 'Privado');
  assert.equal(normalizarSostenimiento(''), '');
  assert.equal(precisionCoordenada('19.12345', '-98.1234'), 'alta');
  assert.equal(precisionCoordenada('19.123', '-98.12345'), 'media', 'manda la menos fina');
  assert.equal(precisionCoordenada('19', '-98.1'), 'baja');
  assert.equal(precisionCoordenada('19°01\'02" N', '98°01\'02" W'), 'media', 'segundos enteros ≈ 30 m');
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
  assert.equal(con.j.escuelas.total, 4, '5 válidas menos 1 repetida');
  assert.equal(con.j.escuelas.resumen.fueraDePuebla, 1);
  assert.equal(con.j.escuelas.aviso, null);
});
