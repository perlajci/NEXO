// Cálculo de presupuestos. Usa el fixture del tabulador con precios INVENTADOS:
//   PRUEBA-001  m2   1000.00  cap 6000  factor 1.00  OFICIAL CAPCEE
//   PRUEBA-002  m2    500.50  cap 6000  factor 1.10  REFERENCIA PÚBLICA
//   PRUEBA-003  pza   200.00  cap 5000  factor 1.00  ESTIMADO
//   PRUEBA-004  %       5     cap 6000  (sin factor)  ESTIMADO
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { procesarTabulador } from '../lib/tabulador.js';
import {
  calcularPresupuesto, redondear2, normalizarCCT, cargarPlanteles, buscarPlantel,
  ErrorPresupuesto, AVISO_ESTIMADOS, SIN_PARTIDA_ESPECIFICA,
} from '../lib/presupuesto.js';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const { conceptos } = procesarTabulador(fs.readFileSync(path.join(DIR, 'fixture/capcee/tabulador_prueba.csv'), 'utf8'));
const calc = (renglones, extra = {}) => calcularPresupuesto({ obra: 'Obra de prueba', renglones, ...extra }, conceptos);
const renglon = (p, clave) => p.renglones.find((r) => r.clave_ref === clave);
const errores = (fn) => { try { fn(); } catch (e) { assert.ok(e instanceof ErrorPresupuesto); return e.errores.join(' '); } return assert.fail('debía rechazarse'); };

test('presupuesto: importe por renglón = cantidad × precio × factor del concepto', () => {
  const p = calc([{ clave_ref: 'PRUEBA-001', cantidad: 10 }, { clave_ref: 'PRUEBA-002', cantidad: 3 }]);
  assert.equal(renglon(p, 'PRUEBA-001').importe, 10000); // 10 × 1000 × 1.00
  assert.equal(renglon(p, 'PRUEBA-002').importe, 1651.65); // 3 × 500.50 × 1.10
  assert.equal(p.factor_presupuesto, 1);
});

test('presupuesto: se multiplican el factor del CSV y el del presupuesto, y ambos se reportan', () => {
  const p = calc([{ clave_ref: 'PRUEBA-002', cantidad: 3 }], { factor: 1.2 });
  const r = renglon(p, 'PRUEBA-002');
  assert.equal(r.importe, 1981.98); // 3 × 500.50 × 1.10 × 1.20
  assert.equal(r.factor_concepto, 1.1);
  assert.equal(r.factor_presupuesto, 1.2);
  assert.match(errores(() => calc([], { factor: 0 })), /factor del presupuesto/);
  assert.match(errores(() => calc([], { factor: 'abc' })), /factor del presupuesto/);
});

test('presupuesto: conceptos % sobre la base del capítulo 6000 ya ajustada, sin factores ni círculo', () => {
  const p = calc([
    { clave_ref: 'PRUEBA-001', cantidad: 10 },
    { clave_ref: 'PRUEBA-002', cantidad: 3 },
    { clave_ref: 'PRUEBA-003', cantidad: 4 }, // capítulo 5000: no entra en la base
    { clave_ref: 'PRUEBA-004', cantidad: 1 }, // 5 %
  ], { factor: 1.2 });
  assert.equal(p.baseObra, 13981.98); // 12000 + 1981.98; sin el 5000 y sin el propio %
  const pct = renglon(p, 'PRUEBA-004');
  assert.equal(pct.importe, 699.1); // 5 % de 13981.98 = 699.099
  assert.equal(pct.porcentaje_de_base, 13981.98);
  assert.equal(pct.factor_concepto, null);
  assert.equal(pct.factor_presupuesto, null);
  assert.match(errores(() => calc([{ clave_ref: 'PRUEBA-004', cantidad: 2 }])), /cantidad 1/);
  // Sin conceptos del capítulo 6000, el % vale 0.
  assert.equal(renglon(calc([{ clave_ref: 'PRUEBA-003', cantidad: 1 }, { clave_ref: 'PRUEBA-004', cantidad: 1 }]), 'PRUEBA-004').importe, 0);
});

test('presupuesto: subtotal, IVA 16 % aparte y total', () => {
  const p = calc([
    { clave_ref: 'PRUEBA-001', cantidad: 10 },
    { clave_ref: 'PRUEBA-002', cantidad: 3 },
    { clave_ref: 'PRUEBA-003', cantidad: 4 },
    { clave_ref: 'PRUEBA-004', cantidad: 1 },
  ], { factor: 1.2 });
  assert.equal(p.subtotal, 15641.08); // 12000 + 1981.98 + 960 + 699.10
  assert.equal(p.tasaIva, 0.16);
  assert.equal(p.iva, 2502.57); // 16 % de 15641.08 = 2502.5728
  assert.equal(p.total, 18143.65);
  assert.equal(renglon(p, 'PRUEBA-001').precio, 1000, 'el precio unitario nunca incluye IVA');
});

test('presupuesto: redondeo a 2 decimales por renglón', () => {
  assert.equal(redondear2(1.005), 1.01);
  assert.equal(redondear2(2.675), 2.68);
  const p = calc([{ clave_ref: 'PRUEBA-002', cantidad: 1.234 }, { clave_ref: 'PRUEBA-003', cantidad: 0.333 }]);
  assert.equal(renglon(p, 'PRUEBA-002').importe, 679.38); // 1.234 × 500.50 × 1.10 = 679.3787
  assert.equal(renglon(p, 'PRUEBA-003').importe, 66.6); // 0.333 × 200 = 66.6
  assert.equal(p.subtotal, 745.98, 'el subtotal suma los importes ya redondeados');
});

test('presupuesto: cantidad 0, negativa o no numérica se rechaza', () => {
  for (const cantidad of [0, -5, 'diez', null]) {
    assert.match(errores(() => calc([{ clave_ref: 'PRUEBA-001', cantidad }])), /mayor que 0/, `cantidad ${cantidad}`);
  }
  assert.match(errores(() => calc([{ clave_ref: 'NO-EXISTE', cantidad: 1 }])), /no está en el tabulador/);
  assert.match(errores(() => calc([{ clave_ref: 'PRUEBA-001', cantidad: 1 }, { clave_ref: 'PRUEBA-001', cantidad: 2 }])), /ya está/);
});

test('presupuesto: sin conceptos da ceros y sin aviso', () => {
  const p = calc([]);
  assert.deepEqual([p.renglones.length, p.subtotal, p.iva, p.total, p.baseObra], [0, 0, 0, 0, 0]);
  assert.equal(p.hayEstimados, false);
  assert.equal(p.aviso, null);
  assert.deepEqual(p.desglose, []);
});

test('presupuesto: aviso de estimados y desglose capítulo → genérica → específica', () => {
  const sin = calc([{ clave_ref: 'PRUEBA-001', cantidad: 1 }]);
  assert.equal(sin.aviso, null);
  const p = calc([{ clave_ref: 'PRUEBA-001', cantidad: 1 }, { clave_ref: 'PRUEBA-002', cantidad: 1 }, { clave_ref: 'PRUEBA-003', cantidad: 1 }]);
  assert.equal(p.aviso, AVISO_ESTIMADOS);
  assert.deepEqual(p.desglose.map((c) => [c.capitulo, c.importe]), [['5000', 200], ['6000', 1550.55]]);
  const g612 = p.desglose[1].genericas[0];
  assert.equal(g612.partida, '612 Edificación no habitacional');
  assert.deepEqual(g612.especificas.map((s) => [s.partida, s.importe, s.claves]), [
    ['61201 Prueba', 1000, ['PRUEBA-001']],
    [SIN_PARTIDA_ESPECIFICA, 550.55, ['PRUEBA-002']],
  ]);
});

test('presupuesto: obra obligatoria y CCT de Puebla en mayúsculas', () => {
  assert.match(errores(() => calcularPresupuesto({ obra: '  ', renglones: [] }, conceptos)), /nombre de la obra/);
  assert.equal(calc([], { cct: ' 21dpr1273g ' }).cct, '21DPR1273G');
  assert.equal(calc([], { cct: '' }).cct, null);
  assert.match(normalizarCCT('21DPR127').error, /10 caracteres/);
  assert.match(normalizarCCT('09DPR1273G').error, /empezar con 21/);
  assert.match(normalizarCCT('21D1R1273G').error, /formato/);
  assert.match(errores(() => calc([], { cct: '15EPR0001A' })), /21/);
});

test('presupuesto: catálogo de planteles preparado (opcional)', () => {
  assert.equal(cargarPlanteles(path.join(os.tmpdir(), 'no-existe-planteles.csv')), null);
  assert.equal(buscarPlantel('21DPR1273G', null), null);
  const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'nexo-pl-')), 'planteles.csv');
  fs.writeFileSync(tmp, '﻿cct,nombre,municipio\n21dpr1273g,Escuela de prueba,Municipio de prueba\n');
  const pl = cargarPlanteles(tmp);
  assert.equal(buscarPlantel('21DPR1273G', pl).nombre, 'Escuela de prueba');
  const p = calcularPresupuesto({ obra: 'X', cct: '21DPR1273G', renglones: [] }, conceptos, pl);
  assert.equal(p.plantel.municipio, 'Municipio de prueba');
});
