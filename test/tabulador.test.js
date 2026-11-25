// Tabulador CAPCEE: lector, validación y API. Usa test/fixture/capcee/tabulador_prueba.csv,
// con conceptos y precios INVENTADOS solo para probar el código (no son precios reales).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { procesarTabulador, leerTabulador, filtrarTabulador, resumenTabulador, COLUMNAS } from '../lib/tabulador.js';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(DIR, 'fixture/capcee/tabulador_prueba.csv');

// ---------- Lector ----------
test('tabulador: lee el CSV con BOM, comas entre comillas y tipos sin acento', () => {
  const { conceptos } = procesarTabulador(fs.readFileSync(FIXTURE, 'utf8'));
  assert.deepEqual(conceptos.map((c) => c.clave_ref), ['PRUEBA-001', 'PRUEBA-002', 'PRUEBA-003', 'PRUEBA-004']);
  const [a, b, c, d] = conceptos;
  assert.equal(a.concepto, 'Aula de prueba, con coma en el concepto');
  assert.equal(a.tipo_dato, 'OFICIAL CAPCEE');
  assert.equal(b.precio, 500.5);
  assert.equal(b.factor_regional, 1.1);
  assert.equal(b.partida_especifica, ''); // vacía = pendiente de COGAPE
  assert.equal(c.factor_regional, 1, 'factor vacío = sin ajuste');
  assert.equal(d.unidad, '%');
  assert.equal(d.tipo_dato, 'ESTIMADO', '"estimado" en minúsculas se reconoce');
});

test('tabulador: descarta filas inválidas y dice por qué', () => {
  const { rechazados } = procesarTabulador(fs.readFileSync(FIXTURE, 'utf8'));
  const motivo = (clave) => rechazados.filter((r) => r.clave_ref === clave).map((r) => r.motivos.join(' ')).join(' ');
  assert.equal(rechazados.length, 4);
  assert.match(motivo('PRUEBA-005'), /precio inválido/);
  assert.match(motivo('PRUEBA-006'), /unidad desconocida "kg"/);
  assert.match(motivo('PRUEBA-001'), /repetida/);
  assert.match(motivo('PRUEBA-007'), /tipo_dato desconocido/);
  assert.deepEqual(rechazados.map((r) => r.fila), [6, 7, 8, 9]);
});

test('tabulador: archivo sin columnas o inexistente no truena', () => {
  assert.throws(() => procesarTabulador('clave_ref,concepto\nX,Y'), /faltan columnas: unidad/);
  assert.throws(() => procesarTabulador(COLUMNAS.join(',')), /vacío/);
  const r = leerTabulador(path.join(os.tmpdir(), 'no-existe-tabulador.csv'));
  assert.equal(r.ok, false);
  assert.match(r.error, /No se encontró/);
});

test('tabulador: filtros y resumen', () => {
  const { conceptos } = procesarTabulador(fs.readFileSync(FIXTURE, 'utf8'));
  assert.deepEqual(filtrarTabulador(conceptos, { buscar: 'REHABILITACION' }).map((c) => c.clave_ref), ['PRUEBA-002']);
  assert.deepEqual(filtrarTabulador(conceptos, { capitulo: '5000' }).map((c) => c.clave_ref), ['PRUEBA-003']);
  assert.deepEqual(filtrarTabulador(conceptos, { tipo: 'referencia publica' }).map((c) => c.clave_ref), ['PRUEBA-002']);
  assert.deepEqual(filtrarTabulador(conceptos, { buscar: 'prueba 612' }).map((c) => c.clave_ref), ['PRUEBA-001', 'PRUEBA-002', 'PRUEBA-004'], 'busca también en la partida');
  assert.equal(filtrarTabulador(conceptos, { buscar: 'aula pupitre' }).length, 0, 'todas las palabras deben coincidir');
  assert.deepEqual(resumenTabulador(conceptos), {
    total: 4,
    porCapitulo: { 6000: 3, 5000: 1 },
    porTipo: { 'OFICIAL CAPCEE': 1, 'REFERENCIA PÚBLICA': 1, ESTIMADO: 2 },
  });
});

// ---------- API ----------
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nexo-tab-'));
fs.mkdirSync(path.join(tmp, 'capcee'));
const ARCHIVO = path.join(tmp, 'capcee', 'tabulador.csv');
fs.copyFileSync(FIXTURE, ARCHIVO);
process.env.NEXO_DATA = tmp; // sin censo ni caché: el tabulador no depende de ellos
process.env.PORT = '0';
const { servidor } = await import('../server.js');
await new Promise((r) => servidor.listen(0, r));
const base = `http://127.0.0.1:${servidor.address().port}`;
const get = (p) => fetch(base + p).then(async (r) => ({ s: r.status, j: await r.json() }));
test.after(() => servidor.close());

test('API tabulador: catálogo filtrado', async () => {
  const todo = await get('/api/tabulador');
  assert.equal(todo.s, 200);
  assert.equal(todo.j.total, 4);
  assert.equal(todo.j.rechazados.length, 4);
  assert.deepEqual(todo.j.catalogos.capitulos, ['2000', '3000', '5000', '6000']);
  const f = await get(`/api/tabulador?buscar=${encodeURIComponent('aula')}&capitulo=6000&tipo=${encodeURIComponent('OFICIAL CAPCEE')}`);
  assert.deepEqual(f.j.conceptos.map((c) => c.clave_ref), ['PRUEBA-001']);
  assert.equal(f.j.totalCatalogo, 4);
});

test('API tabulador: resumen por capítulo y tipo', async () => {
  const { s, j } = await get('/api/tabulador/resumen');
  assert.equal(s, 200);
  assert.equal(j.total, 4);
  assert.equal(j.porCapitulo['6000'], 3);
  assert.equal(j.porTipo.ESTIMADO, 2);
  assert.equal(j.rechazados, 4);
});

test('API tabulador: sin archivo o sin columnas avisa y el servidor sigue en pie', async () => {
  fs.renameSync(ARCHIVO, `${ARCHIVO}.bak`);
  const sin = await get('/api/tabulador');
  assert.equal(sin.s, 409);
  assert.match(sin.j.error, /No se encontró/);
  fs.writeFileSync(ARCHIVO, '﻿clave_ref,concepto,precio\nX,Y,1\n');
  const mal = await get('/api/tabulador/resumen');
  assert.equal(mal.s, 409);
  assert.match(mal.j.error, /faltan columnas/);
  fs.renameSync(`${ARCHIVO}.bak`, ARCHIVO);
  const otra = await get('/api/tabulador');
  assert.equal(otra.s, 200);
  assert.equal(otra.j.total, 4);
});
