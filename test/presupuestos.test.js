// Presupuestos guardados: almacén, copia fija de precios, CSV y API.
// Usa el fixture del tabulador con precios INVENTADOS (ver test/presupuesto.test.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { crearAlmacenJSON } from '../lib/almacen.js';
import { nombreArchivoCSV, presupuestoACSV } from '../lib/presupuestos.js';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(DIR, 'fixture/capcee/tabulador_prueba.csv');

// ---------- Almacén ----------
test('almacén JSON: guardar, listar, obtener, reemplazar y borrar', () => {
  const ruta = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'nexo-alm-')), 'sub', 'datos.json');
  const a = crearAlmacenJSON(ruta);
  assert.deepEqual(a.listar(), [], 'sin archivo empieza vacío');
  a.guardar({ id: 'uno', v: 1 });
  a.guardar({ id: 'dos', v: 2 });
  a.guardar({ id: 'uno', v: 3 });
  assert.deepEqual(a.listar().map((x) => [x.id, x.v]), [['uno', 3], ['dos', 2]]);
  assert.equal(a.obtener('dos').v, 2);
  assert.equal(a.obtener('tres'), null);
  assert.equal(a.borrar('uno'), true);
  assert.equal(a.borrar('uno'), false);
  assert.deepEqual(a.listar().map((x) => x.id), ['dos']);
  assert.throws(() => a.guardar({ v: 1 }), /id/);
  fs.writeFileSync(ruta, '{dañado');
  assert.deepEqual(a.listar(), [], 'un archivo dañado no tumba el servidor');
});

test('nombre del CSV sin acentos, espacios ni signos, con fecha de Puebla', () => {
  // 02:00 UTC del 26 = 20:00 del 25 en Puebla.
  assert.equal(nombreArchivoCSV({ obra: 'Rehabilitación de aulas, Niño Artillero #3', fecha: '2026-11-26T02:00:00Z' }), 'presupuesto_Rehabilitacion_de_aulas_Nino_Artillero_3_2026-11-25.csv');
  assert.equal(nombreArchivoCSV({ obra: '¡¡!!', fecha: '2026-11-25T18:00:00Z' }), 'presupuesto_obra_2026-11-25.csv');
});

// ---------- API ----------
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nexo-pres-'));
fs.mkdirSync(path.join(tmp, 'capcee'));
const ARCHIVO = path.join(tmp, 'capcee', 'tabulador.csv');
fs.copyFileSync(FIXTURE, ARCHIVO);
process.env.NEXO_DATA = tmp;
process.env.PORT = '0';
const { servidor } = await import('../server.js');
await new Promise((r) => servidor.listen(0, r));
const base = `http://127.0.0.1:${servidor.address().port}`;
const pedir = (p, metodo = 'GET', cuerpo) => fetch(base + p, {
  method: metodo, headers: cuerpo ? { 'content-type': 'application/json' } : {}, body: cuerpo ? JSON.stringify(cuerpo) : undefined,
});
const json = async (p, metodo, cuerpo) => { const r = await pedir(p, metodo, cuerpo); return { s: r.status, j: await r.json() }; };
test.after(() => servidor.close());

// factor 1.2: 10 × 1000 × 1.2 = 12000; 3 × 500.50 × 1.10 × 1.2 = 1981.98; 4 × 200 × 1.2 = 960;
// 5 % de (12000 + 1981.98) = 699.10. Subtotal 15641.08, IVA 2502.57, total 18143.65.
const ENTRADA = {
  obra: 'Rehabilitación de aulas, Primaria "Niño Artillero"', cct: '21dpr1273g', factor: 1.2,
  renglones: [
    { clave_ref: 'PRUEBA-001', cantidad: 10 },
    { clave_ref: 'PRUEBA-002', cantidad: 3 },
    { clave_ref: 'PRUEBA-003', cantidad: 4 },
    { clave_ref: 'PRUEBA-004', cantidad: 1 },
  ],
};
let guardado;

test('API presupuestos: guardar y recuperar con copia de precios y huella', async () => {
  const { s, j } = await json('/api/presupuestos', 'POST', ENTRADA);
  assert.equal(s, 201);
  guardado = j;
  assert.ok(j.id);
  assert.equal(j.cct, '21DPR1273G');
  assert.equal(j.total, 18143.65);
  assert.match(j.tabulador.huella, /^[0-9a-f]{64}$/);
  const r2 = j.renglones.find((r) => r.clave_ref === 'PRUEBA-002');
  assert.deepEqual([r2.concepto, r2.unidad, r2.precio, r2.factor_concepto, r2.factor_presupuesto, r2.capitulo, r2.partida_generica, r2.partida_especifica],
    ['Rehabilitación de prueba', 'm2', 500.5, 1.1, 1.2, '6000', '612 Edificación no habitacional', 'Pendiente COGAPE']);
  const uno = await json(`/api/presupuestos/${j.id}`);
  assert.equal(uno.s, 200);
  assert.equal(uno.j.total, 18143.65);
  assert.equal(uno.j.comparacion.tabuladorAnterior, false);
  const lista = await json('/api/presupuestos');
  assert.match(lista.j.aviso, /Render/);
  assert.deepEqual(lista.j.presupuestos.map((p) => [p.id, p.total, p.conceptos, p.tabuladorAnterior]), [[j.id, 18143.65, 4, false]]);
});

test('API presupuestos: el servidor recalcula e ignora totales y precios falsos', async () => {
  const falso = {
    ...ENTRADA, subtotal: 1, iva: 0, total: 1, hayEstimados: false,
    renglones: ENTRADA.renglones.map((r) => ({ ...r, precio: 0.01, importe: 0.01, factor_concepto: 0.01, tipo_dato: 'OFICIAL CAPCEE' })),
  };
  const { s, j } = await json('/api/presupuestos', 'POST', falso);
  assert.equal(s, 201);
  assert.equal(j.subtotal, 15641.08);
  assert.equal(j.total, 18143.65);
  assert.equal(j.renglones.find((r) => r.clave_ref === 'PRUEBA-001').precio, 1000);
  assert.equal(j.hayEstimados, true);
  await json(`/api/presupuestos/${j.id}`, 'DELETE');
});

test('API presupuestos: rechaza sin conceptos, sin obra o con cantidad inválida', async () => {
  const vacio = await json('/api/presupuestos', 'POST', { obra: 'Obra', renglones: [] });
  assert.equal(vacio.s, 400);
  assert.match(vacio.j.error, /al menos un concepto/);
  const malo = await json('/api/presupuestos', 'POST', { obra: '', renglones: [{ clave_ref: 'PRUEBA-001', cantidad: 0 }] });
  assert.equal(malo.s, 400);
  assert.equal(malo.j.errores.length, 2);
  assert.equal((await json('/api/presupuestos')).j.presupuestos.length, 1, 'no se guardó nada');
});

test('API presupuestos: CSV con BOM, encabezado, partidas y totales', async () => {
  const r = await pedir(`/api/presupuestos/${guardado.id}/csv`);
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /text\/csv; charset=utf-8/);
  assert.match(r.headers.get('content-disposition'), /filename="presupuesto_Rehabilitacion_de_aulas_Primaria_Nino_Artillero_\d{4}-\d{2}-\d{2}\.csv"/);
  const bytes = Buffer.from(await r.arrayBuffer());
  assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf], 'BOM UTF-8');
  const lineas = bytes.toString('utf8').slice(1).split('\r\n');
  assert.equal(lineas[1], 'Obra,"Rehabilitación de aulas, Primaria ""Niño Artillero"""');
  assert.equal(lineas[2], 'CCT,21DPR1273G');
  assert.match(lineas[3], /^Fecha,\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  assert.equal(lineas[4], 'Factor del presupuesto,1.20');
  assert.equal(lineas[5], `Huella del tabulador (SHA-256),${guardado.tabulador.huella}`);
  assert.equal(lineas[6], 'Aviso,Este presupuesto usa precios estimados; no es un costo oficial');
  assert.ok(lineas.includes('Clave,Concepto,Unidad,Cantidad,Precio unitario sin IVA,Factor del concepto,Factor del presupuesto,Importe,Capítulo,Partida genérica,Partida específica,Tipo de dato'));
  assert.ok(lineas.includes('PRUEBA-002,Rehabilitación de prueba,m2,3,500.50,1.10,1.20,1981.98,6000,612 Edificación no habitacional,Pendiente COGAPE,REFERENCIA PÚBLICA'));
  assert.ok(lineas.includes('PRUEBA-001,"Aula de prueba, con coma en el concepto",m2,10,1000.00,1.00,1.20,12000.00,6000,612 Edificación no habitacional,61201 Prueba,OFICIAL CAPCEE'));
  assert.ok(lineas.includes('PRUEBA-004,Supervisión de prueba como porcentaje (5.00 % de 13981.98),%,1,5.00,No aplica,No aplica,699.10,6000,612 Edificación no habitacional,Pendiente COGAPE,ESTIMADO'));
  // Subtotales por capítulo y por partida genérica, subtotal, IVA y total.
  const desde = (t) => lineas.slice(lineas.indexOf(t) + 2);
  assert.deepEqual(desde('Subtotales por capítulo').slice(0, 2), ['5000,960.00', '6000,14681.08']);
  assert.deepEqual(desde('Subtotales por partida genérica').slice(0, 2), ['5000,511 Muebles de oficina y estantería,960.00', '6000,612 Edificación no habitacional,14681.08']);
  assert.deepEqual(lineas.slice(-4, -1), ['Subtotal,15641.08', 'IVA 16 %,2502.57', 'Total,18143.65']);
});

test('CSV: un texto que empieza con = se escapa para que Excel no lo ejecute', () => {
  const csv = presupuestoACSV({ ...guardado, obra: '=HYPERLINK("http://x")' });
  assert.ok(csv.includes(`Obra,"'=HYPERLINK(""http://x"")"`));
});

test('API presupuestos: un tabulador nuevo no cambia lo guardado y se marca como anterior', async () => {
  const antes = (await json(`/api/presupuestos/${guardado.id}`)).j;
  // Nuevo tabulador: PRUEBA-001 sube de 1000 a 2500.25.
  fs.writeFileSync(ARCHIVO, fs.readFileSync(FIXTURE, 'utf8').replace('m2,1000,6000', 'm2,2500.25,6000'));
  const nuevo = await json('/api/tabulador?buscar=PRUEBA-001');
  assert.equal(nuevo.j.conceptos[0].precio, 2500.25, 'el tabulador sí cambió');
  const despues = (await json(`/api/presupuestos/${guardado.id}`)).j;
  assert.equal(despues.total, antes.total);
  assert.deepEqual(despues.renglones, antes.renglones);
  assert.equal(despues.tabulador.huella, antes.tabulador.huella);
  assert.notEqual(despues.huellaActual, antes.tabulador.huella);
  assert.equal(despues.comparacion.tabuladorAnterior, true);
  assert.deepEqual(despues.comparacion.cambios, [{ clave_ref: 'PRUEBA-001', motivo: 'precio 1000 → 2500.25' }]);
  assert.equal((await json('/api/presupuestos')).j.presupuestos[0].tabuladorAnterior, true);
  // Uno nuevo con el mismo contenido sí usa el precio nuevo y no es "anterior".
  const otro = (await json('/api/presupuestos', 'POST', { obra: 'Otra obra', renglones: [{ clave_ref: 'PRUEBA-001', cantidad: 1 }] })).j;
  assert.equal(otro.subtotal, 2500.25);
  assert.equal((await json(`/api/presupuestos/${otro.id}`)).j.comparacion.tabuladorAnterior, false);
  await json(`/api/presupuestos/${otro.id}`, 'DELETE');
  fs.copyFileSync(FIXTURE, ARCHIVO);
});

test('API presupuestos: marcar para Recursos CAPCEE', async () => {
  const { s, j } = await json(`/api/presupuestos/${guardado.id}/recursos`, 'POST');
  assert.equal(s, 200);
  assert.equal(j.total, 18143.65);
  assert.equal(j.requiereValidacion, true);
  assert.deepEqual(j.porCapitulo, [{ capitulo: '5000', importe: 960 }, { capitulo: '6000', importe: 14681.08 }]);
  assert.ok(j.marcadoEn);
  assert.equal((await json('/api/presupuestos?recursos=1')).j.presupuestos.length, 1);
});

test('API presupuestos: borrar', async () => {
  assert.equal((await json(`/api/presupuestos/${guardado.id}`, 'DELETE')).s, 200);
  assert.equal((await json(`/api/presupuestos/${guardado.id}`)).s, 404);
  assert.equal((await json(`/api/presupuestos/${guardado.id}`, 'DELETE')).s, 404);
  assert.equal((await pedir(`/api/presupuestos/${guardado.id}/csv`)).status, 404);
  assert.deepEqual((await json('/api/presupuestos')).j.presupuestos, []);
});
