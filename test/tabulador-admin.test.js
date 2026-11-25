// Actualizar el tabulador: validación, diferencias, clave, respaldo, escritura atómica e historial.
// Datos INVENTADOS a partir del fixture (solo para probar el código).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { procesarTabulador, huellaDe } from '../lib/tabulador.js';
import {
  validarCSV, compararTabuladores, escribirAtomico, nombreRespaldo, reemplazarTabulador, listarHistorial, claveCorrecta,
} from '../lib/tabulador-admin.js';

const DIR = path.dirname(fileURLToPath(import.meta.url));
// El fixture trae 4 renglones válidos y 4 inválidos a propósito; la versión "limpia" solo los válidos.
const LINEAS = fs.readFileSync(path.join(DIR, 'fixture/capcee/tabulador_prueba.csv'), 'utf8').split(/\r?\n/);
const LIMPIO = `${LINEAS.slice(0, 5).join('\n')}\n`; // incluye el BOM de la primera línea
const linea = (clave) => LINEAS.find((l) => l.startsWith(`${clave},`));
// Versión nueva: PRUEBA-001 sube de 1000 a 1100 (+10 %), PRUEBA-002 cambia de unidad y factor,
// PRUEBA-003 desaparece y llega PRUEBA-010.
const NUEVO = [
  LINEAS[0],
  linea('PRUEBA-001').replace(',m2,1000,', ',m2,1100,'),
  linea('PRUEBA-002').replace(',m2,500.50,', ',m3,500.50,').replace(',1.10,REFERENCIA', ',1.20,REFERENCIA'),
  linea('PRUEBA-004'),
  'PRUEBA-010,Concepto nuevo de prueba,pza,75.5,5000,511 Muebles de oficina y estantería,,1.0,ESTIMADO,DATOS DE PRUEBA (inventados solo para probar el código)',
].join('\n') + '\n';
const buf = (s) => Buffer.from(s, 'utf8');

// ---------- Unidades ----------
test('admin: un CSV válido se acepta y se guarda con BOM', () => {
  const v = validarCSV(buf(LIMPIO));
  assert.equal(v.ok, true);
  assert.equal(v.conceptos.length, 4);
  const sinBom = validarCSV(buf(LIMPIO.replace(/^﻿/, '')));
  assert.deepEqual([...sinBom.contenido.subarray(0, 3)], [0xef, 0xbb, 0xbf], 'se le agrega el BOM');
  assert.equal(sinBom.huella, v.huella, 'mismo contenido, misma huella');
});

test('admin: un CSV con errores se rechaza completo, con renglón y motivo', () => {
  const v = validarCSV(fs.readFileSync(path.join(DIR, 'fixture/capcee/tabulador_prueba.csv')));
  assert.equal(v.ok, false);
  assert.deepEqual(v.errores.map((e) => e.fila), [6, 7, 8, 9]);
  assert.match(v.errores[0].motivos[0], /precio inválido/);
  assert.match(validarCSV(buf('clave_ref,concepto\nX,Y\n')).errores[0].motivos[0], /faltan columnas/);
  assert.equal(validarCSV(buf('clave_ref,concepto\nX,Y\n')).errores[0].fila, 1);
  assert.match(validarCSV(Buffer.from([0x63, 0x6c, 0xe1, 0x76, 0x65])).errores[0].motivos[0], /UTF-8/); // "clÃ¡ve" en Latin-1
  assert.match(validarCSV(Buffer.alloc(1024 * 1024 + 1, 0x61)).errores[0].motivos[0], /límite es 1 MB/);
  assert.match(validarCSV(Buffer.alloc(0)).errores[0].motivos[0], /vacío/);
});

test('admin: diferencias con qué cambió, $ y %, y presupuestos que usan cada concepto', () => {
  const actuales = procesarTabulador(LIMPIO).conceptos;
  const nuevos = procesarTabulador(NUEVO).conceptos;
  const guardados = [
    { id: 'p1', renglones: [{ clave_ref: 'PRUEBA-001' }, { clave_ref: 'PRUEBA-003' }] },
    { id: 'p2', renglones: [{ clave_ref: 'PRUEBA-001' }] },
    { id: 'p3', renglones: [{ clave_ref: 'PRUEBA-004' }] },
  ];
  const d = compararTabuladores(actuales, nuevos, guardados);
  assert.deepEqual(d.nuevos.map((x) => x.clave_ref), ['PRUEBA-010']);
  assert.deepEqual(d.eliminados.map((x) => [x.clave_ref, x.presupuestos]), [['PRUEBA-003', 1]]);
  assert.equal(d.sinCambio, 1); // PRUEBA-004
  const m1 = d.modificados.find((x) => x.clave_ref === 'PRUEBA-001');
  assert.deepEqual(m1.precio, { antes: 1000, despues: 1100, difMxn: 100, difPct: 10 });
  assert.deepEqual(m1.cambios.map((c) => c.campo), ['precio']);
  assert.equal(m1.presupuestos, 2);
  const m2 = d.modificados.find((x) => x.clave_ref === 'PRUEBA-002');
  assert.equal(m2.precio, null);
  assert.deepEqual(m2.cambios.map((c) => [c.campo, c.antes, c.despues]), [['unidad', 'm2', 'm3'], ['factor_regional', 1.1, 1.2]]);
  assert.equal(m2.presupuestos, 0);
  assert.equal(d.presupuestosAfectados, 2, 'p1 y p2; p3 usa un concepto sin cambios');
  assert.equal(d.identico, false);
  assert.equal(compararTabuladores(actuales, actuales).identico, true);
});

test('admin: escritura atómica; si falla el renombrado, el archivo viejo queda intacto', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexo-atom-'));
  const ruta = path.join(dir, 'tabulador.csv');
  fs.writeFileSync(ruta, 'VIEJO');
  assert.throws(() => escribirAtomico(ruta, 'NUEVO A MEDIAS', { renombrar: () => { throw new Error('se cortó la luz'); } }), /se cortó la luz/);
  assert.equal(fs.readFileSync(ruta, 'utf8'), 'VIEJO');
  assert.deepEqual(fs.readdirSync(dir), ['tabulador.csv'], 'no quedan temporales');
  escribirAtomico(ruta, 'NUEVO');
  assert.equal(fs.readFileSync(ruta, 'utf8'), 'NUEVO');
  assert.deepEqual(fs.readdirSync(dir), ['tabulador.csv']);
});

test('admin: nombre del respaldo con fecha y hora de Puebla y huella corta', () => {
  assert.equal(nombreRespaldo('abcdef1234567890', new Date('2026-11-26T02:05:09Z')), 'tabulador_2026-11-25_200509_abcdef12.csv');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexo-resp-'));
  const ruta = path.join(dir, 'tabulador.csv');
  const hist = path.join(dir, 'historial');
  assert.equal(reemplazarTabulador({ ruta, dirHistorial: hist, contenido: buf(LIMPIO) }).respaldo, null, 'sin archivo previo no hay respaldo');
  const ahora = new Date('2026-11-26T02:05:09Z');
  const a = reemplazarTabulador({ ruta, dirHistorial: hist, contenido: buf(NUEVO), ahora });
  const b = reemplazarTabulador({ ruta, dirHistorial: hist, contenido: buf(LIMPIO), ahora });
  assert.notEqual(a.respaldo, b.respaldo, 'dos respaldos en el mismo segundo no se pisan');
  assert.equal(fs.readFileSync(path.join(hist, a.respaldo), 'utf8'), LIMPIO);
  assert.equal(fs.readFileSync(path.join(hist, b.respaldo), 'utf8'), NUEVO);
  assert.deepEqual(listarHistorial(hist).map((v) => [v.fecha, v.conceptos]), [['2026-11-25 20:05:09', 4], ['2026-11-25 20:05:09', 4]]);
});

test('admin: la clave se compara completa', () => {
  assert.equal(claveCorrecta('secreta', 'secreta'), true);
  assert.equal(claveCorrecta('secret', 'secreta'), false);
  assert.equal(claveCorrecta('', 'secreta'), false);
  assert.equal(claveCorrecta('x', undefined), false);
});

// ---------- API ----------
const CLAVE = 'clave-de-prueba-123';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nexo-adm-'));
fs.mkdirSync(path.join(tmp, 'capcee'));
const ARCHIVO = path.join(tmp, 'capcee', 'tabulador.csv');
const HIST = path.join(tmp, 'capcee', 'historial');
fs.writeFileSync(ARCHIVO, LIMPIO);
process.env.NEXO_DATA = tmp;
process.env.PORT = '0';
delete process.env.TABULADOR_ADMIN_KEY;
const { servidor } = await import('../server.js');
await new Promise((r) => servidor.listen(0, r));
const base = `http://127.0.0.1:${servidor.address().port}`;
const pedir = async (ruta, { metodo = 'GET', cuerpo, clave, encabezados = {} } = {}) => {
  const h = { ...encabezados };
  if (clave !== undefined) h['X-Admin-Key'] = clave;
  if (cuerpo !== undefined && typeof cuerpo !== 'string') h['Content-Type'] = 'application/json';
  const r = await fetch(base + ruta, { method: metodo, headers: h, body: cuerpo === undefined ? undefined : (typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo)) });
  return { s: r.status, j: await r.json() };
};
test.after(() => servidor.close());

test('API admin: sin variable 403, sin clave 401, clave equivocada 403', async () => {
  for (const ruta of ['/api/tabulador/previsualizar', '/api/tabulador/aplicar', '/api/tabulador/restaurar']) {
    delete process.env.TABULADOR_ADMIN_KEY;
    const apagado = await pedir(ruta, { metodo: 'POST', cuerpo: NUEVO, clave: CLAVE });
    assert.equal(apagado.s, 403, ruta);
    assert.match(apagado.j.error, /TABULADOR_ADMIN_KEY/);
    process.env.TABULADOR_ADMIN_KEY = CLAVE;
    assert.equal((await pedir(ruta, { metodo: 'POST', cuerpo: NUEVO })).s, 401, ruta);
    assert.equal((await pedir(ruta, { metodo: 'POST', cuerpo: NUEVO, clave: 'otra' })).s, 403, ruta);
  }
  delete process.env.TABULADOR_ADMIN_KEY;
  assert.equal((await pedir('/api/tabulador/historial')).j.habilitado, false);
  process.env.TABULADOR_ADMIN_KEY = CLAVE;
  assert.equal((await pedir('/api/tabulador/historial')).j.habilitado, true);
  assert.equal(fs.readFileSync(ARCHIVO, 'utf8'), LIMPIO, 'nada cambió');
});

let guardado;
let previa;
test('API admin: previsualizar no aplica nada y muestra diferencias', async () => {
  guardado = (await pedir('/api/presupuestos', { metodo: 'POST', cuerpo: { obra: 'Obra de prueba', renglones: [{ clave_ref: 'PRUEBA-001', cantidad: 10 }, { clave_ref: 'PRUEBA-003', cantidad: 2 }] } })).j;
  const { s, j } = await pedir('/api/tabulador/previsualizar', { metodo: 'POST', cuerpo: NUEVO, clave: CLAVE });
  assert.equal(s, 200);
  previa = j;
  assert.equal(j.base, huellaDe(fs.readFileSync(ARCHIVO)));
  assert.equal(j.conceptosNuevos, 4);
  assert.deepEqual(j.diferencias.eliminados.map((x) => [x.clave_ref, x.presupuestos]), [['PRUEBA-003', 1]]);
  assert.deepEqual(j.diferencias.modificados.find((x) => x.clave_ref === 'PRUEBA-001').precio, { antes: 1000, despues: 1100, difMxn: 100, difPct: 10 });
  assert.equal(j.diferencias.presupuestosAfectados, 1);
  assert.equal(fs.readFileSync(ARCHIVO, 'utf8'), LIMPIO, 'previsualizar no toca el archivo');
  assert.equal((await pedir('/api/tabulador?buscar=PRUEBA-001')).j.conceptos[0].precio, 1000);
});

test('API admin: CSV con errores responde 422 con renglón y motivo', async () => {
  const malo = `${LIMPIO}PRUEBA-020,Sin precio,m2,0,6000,612 Edificación no habitacional,,1.0,ESTIMADO,prueba\nPRUEBA-021,Unidad rara,kg,5,6000,612 Edificación no habitacional,,1.0,ESTIMADO,prueba\n`;
  const { s, j } = await pedir('/api/tabulador/previsualizar', { metodo: 'POST', cuerpo: malo, clave: CLAVE });
  assert.equal(s, 422);
  assert.deepEqual(j.errores.map((e) => [e.fila, e.clave_ref]), [[6, 'PRUEBA-020'], [7, 'PRUEBA-021']]);
  assert.match(j.errores[1].motivos[0], /unidad desconocida "kg"/);
  const grande = await fetch(`${base}/api/tabulador/previsualizar`, { method: 'POST', headers: { 'X-Admin-Key': CLAVE }, body: Buffer.alloc(1024 * 1024 + 10, 0x61) });
  assert.equal(grande.status, 413);
});

test('API admin: aplicar exige que nada haya cambiado desde la previsualización', async () => {
  const h = (b, n) => ({ 'X-Huella-Base': b, 'X-Huella-Nueva': n });
  assert.equal((await pedir('/api/tabulador/aplicar', { metodo: 'POST', cuerpo: NUEVO, clave: CLAVE, encabezados: h('otra', previa.huellaNueva) })).s, 409);
  assert.equal((await pedir('/api/tabulador/aplicar', { metodo: 'POST', cuerpo: NUEVO, clave: CLAVE, encabezados: h(previa.base, 'otra') })).s, 409);
  assert.equal(fs.existsSync(HIST), false, 'sin respaldo porque no se aplicó');
});

test('API admin: aplicar respalda, reemplaza sin reiniciar y no cambia presupuestos guardados', async () => {
  const antes = fs.readFileSync(ARCHIVO);
  const { s, j } = await pedir('/api/tabulador/aplicar', { metodo: 'POST', cuerpo: NUEVO, clave: CLAVE, encabezados: { 'X-Huella-Base': previa.base, 'X-Huella-Nueva': previa.huellaNueva } });
  assert.equal(s, 200, JSON.stringify(j));
  assert.match(j.respaldo, /^tabulador_\d{4}-\d{2}-\d{2}_\d{6}_[0-9a-f]{8}\.csv$/);
  assert.equal(j.respaldo.slice(-12, -4), huellaDe(antes).slice(0, 8));
  assert.deepEqual(fs.readFileSync(path.join(HIST, j.respaldo)), antes, 'el respaldo es el tabulador anterior completo');
  assert.equal(fs.readFileSync(ARCHIVO, 'utf8'), NUEVO);
  assert.deepEqual(fs.readdirSync(path.dirname(ARCHIVO)).sort(), ['historial', 'tabulador.csv'], 'no quedan temporales');
  // Catálogo e indicadores nuevos sin reiniciar.
  assert.equal((await pedir('/api/tabulador?buscar=PRUEBA-001')).j.conceptos[0].precio, 1100);
  assert.equal((await pedir('/api/tabulador/resumen')).j.total, 4);
  assert.equal((await pedir('/api/tabulador?buscar=PRUEBA-003')).j.total, 0);
  // El presupuesto guardado conserva sus precios y se marca como "tabulador anterior".
  const p = (await pedir(`/api/presupuestos/${guardado.id}`)).j;
  assert.equal(p.total, guardado.total);
  assert.deepEqual(p.renglones, guardado.renglones);
  assert.equal(p.comparacion.tabuladorAnterior, true);
});

test('API admin: historial y restaurar (con respaldo previo)', async () => {
  const h = (await pedir('/api/tabulador/historial')).j;
  assert.equal(h.versiones.length, 1);
  assert.equal(h.versiones[0].conceptos, 4);
  assert.match(h.aviso, /Render/);
  const archivo = h.versiones[0].archivo;
  assert.equal((await pedir('/api/tabulador/restaurar', { metodo: 'POST', cuerpo: { archivo: '../tabulador.csv' }, clave: CLAVE })).s, 400);
  assert.equal((await pedir('/api/tabulador/restaurar', { metodo: 'POST', cuerpo: { archivo: 'tabulador_2000-01-01_000000_00000000.csv' }, clave: CLAVE })).s, 404);
  const r = await pedir('/api/tabulador/restaurar', { metodo: 'POST', cuerpo: { archivo }, clave: CLAVE });
  assert.equal(r.s, 200, JSON.stringify(r.j));
  assert.equal(fs.readFileSync(ARCHIVO, 'utf8'), LIMPIO, 'volvió la versión anterior');
  assert.equal(fs.readFileSync(path.join(HIST, r.j.respaldo), 'utf8'), NUEVO, 'y se respaldó la que estaba');
  assert.equal((await pedir('/api/tabulador/historial')).j.versiones.length, 2);
  assert.equal((await pedir('/api/tabulador?buscar=PRUEBA-001')).j.conceptos[0].precio, 1000);
  assert.equal((await pedir(`/api/presupuestos/${guardado.id}`)).j.total, guardado.total);
});
