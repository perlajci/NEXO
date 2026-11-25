// Presupuestos guardados: copia fija de precios, comparación con el tabulador actual,
// exportación a CSV y entrega al futuro módulo "Recursos CAPCEE".
import { randomUUID } from 'node:crypto';
import { SIN_PARTIDA_ESPECIFICA, AVISO_ESTIMADOS } from './presupuesto.js';

// Arma el registro a guardar a partir de un cálculo HECHO EN EL SERVIDOR (calcularPresupuesto).
// Cada renglón ya trae concepto, unidad, precio, factores, capítulo y partidas de ese día:
// es una copia, así que un tabulador nuevo no cambia lo guardado.
export function armarGuardado(calculo, tabulador, { id = randomUUID(), fecha = new Date().toISOString() } = {}) {
  if (!calculo.renglones.length) throw new Error('Agrega al menos un concepto antes de guardar.');
  return {
    id,
    fecha,
    obra: calculo.obra,
    cct: calculo.cct,
    plantel: calculo.plantel,
    factor_presupuesto: calculo.factor_presupuesto,
    tabulador: { huella: tabulador.huella, actualizado: tabulador.actualizado },
    renglones: calculo.renglones,
    baseObra: calculo.baseObra,
    subtotal: calculo.subtotal,
    tasaIva: calculo.tasaIva,
    iva: calculo.iva,
    total: calculo.total,
    hayEstimados: calculo.hayEstimados,
    aviso: calculo.aviso,
    desglose: calculo.desglose,
    recursosCapcee: null, // fecha en que se marcó para Recursos CAPCEE
  };
}

// ¿El presupuesto usa precios distintos a los del tabulador actual?
// Compara renglón por renglón (precio, unidad y factor), no solo la huella: un cambio en
// otro concepto del CSV no vuelve "anterior" a un presupuesto que no lo usa.
export function compararConTabulador(p, catalogo) {
  const actual = new Map(catalogo.map((c) => [c.clave_ref, c]));
  const cambios = [];
  for (const r of p.renglones) {
    const c = actual.get(r.clave_ref);
    if (!c) { cambios.push({ clave_ref: r.clave_ref, motivo: 'ya no está en el tabulador' }); continue; }
    if (c.precio !== r.precio) cambios.push({ clave_ref: r.clave_ref, motivo: `precio ${r.precio} → ${c.precio}` });
    else if (c.unidad !== r.unidad) cambios.push({ clave_ref: r.clave_ref, motivo: `unidad ${r.unidad} → ${c.unidad}` });
    else if (r.unidad !== '%' && c.factor_regional !== r.factor_concepto) cambios.push({ clave_ref: r.clave_ref, motivo: `factor ${r.factor_concepto} → ${c.factor_regional}` });
  }
  return { tabuladorAnterior: cambios.length > 0, cambios };
}

// Lo mínimo para la lista de "Presupuestos guardados".
export const resumenGuardado = (p, catalogo) => ({
  id: p.id, obra: p.obra, cct: p.cct, fecha: p.fecha, total: p.total,
  conceptos: p.renglones.length, hayEstimados: p.hayEstimados,
  recursosCapcee: p.recursosCapcee,
  tabuladorAnterior: catalogo ? compararConTabulador(p, catalogo).tabuladorAnterior : null,
});

// ---------- CSV para Excel ----------
const BOM = '﻿';
// Comillas cuando hace falta y protección contra fórmulas: un texto que empieza con
// = + - @ se abriría en Excel como fórmula, así que se le antepone un apóstrofo.
function celda(v) {
  if (v === null || v === undefined) return '';
  let s = String(v);
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
const fila = (...cols) => cols.map(celda).join(',');
const n2 = (x) => (x === null || x === undefined ? '' : Number(x).toFixed(2));
// Fechas en hora de Puebla aunque el servidor corra en UTC (como en Render).
const ZONA = 'America/Mexico_City';
export const fechaLocal = (iso) => new Intl.DateTimeFormat('sv-SE', {
  timeZone: ZONA, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
}).format(new Date(iso)); // "2026-11-25 19:05"

export function presupuestoACSV(p) {
  const L = [];
  L.push(fila('Presupuesto de obra escolar (PIANI)'));
  L.push(fila('Obra', p.obra));
  L.push(fila('CCT', p.cct || ''));
  L.push(fila('Fecha', fechaLocal(p.fecha)));
  L.push(fila('Factor del presupuesto', n2(p.factor_presupuesto)));
  L.push(fila('Huella del tabulador (SHA-256)', p.tabulador?.huella || ''));
  if (p.hayEstimados) L.push(fila('Aviso', AVISO_ESTIMADOS));
  L.push(fila('Precios sin IVA', 'El IVA va en una línea aparte al final'));
  L.push('');
  L.push(fila('Clave', 'Concepto', 'Unidad', 'Cantidad', 'Precio unitario sin IVA', 'Factor del concepto', 'Factor del presupuesto', 'Importe', 'Capítulo', 'Partida genérica', 'Partida específica', 'Tipo de dato'));
  for (const r of p.renglones) {
    const pctj = r.unidad === '%';
    L.push(fila(
      r.clave_ref,
      pctj ? `${r.concepto} (${n2(r.precio)} % de ${n2(r.porcentaje_de_base)})` : r.concepto,
      r.unidad,
      r.cantidad,
      n2(r.precio),
      pctj ? 'No aplica' : n2(r.factor_concepto),
      pctj ? 'No aplica' : n2(r.factor_presupuesto),
      n2(r.importe),
      r.capitulo,
      r.partida_generica,
      r.partida_especifica || SIN_PARTIDA_ESPECIFICA,
      r.tipo_dato,
    ));
  }
  L.push('');
  L.push(fila('Subtotales por capítulo'));
  L.push(fila('Capítulo', 'Importe'));
  for (const c of p.desglose) L.push(fila(c.capitulo, n2(c.importe)));
  L.push('');
  L.push(fila('Subtotales por partida genérica'));
  L.push(fila('Capítulo', 'Partida genérica', 'Importe'));
  for (const c of p.desglose) for (const g of c.genericas) L.push(fila(c.capitulo, g.partida, n2(g.importe)));
  L.push('');
  L.push(fila('Subtotal', n2(p.subtotal)));
  L.push(fila(`IVA ${Math.round((p.tasaIva ?? 0.16) * 100)} %`, n2(p.iva)));
  L.push(fila('Total', n2(p.total)));
  return BOM + L.join('\r\n') + '\r\n';
}

// presupuesto_<obra>_<fecha>.csv, sin acentos, espacios ni signos.
export function nombreArchivoCSV(p) {
  const obra = String(p.obra || 'obra')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/ñ/gi, 'n')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 50)
    .replace(/_+$/, '') || 'obra';
  return `presupuesto_${obra}_${fechaLocal(p.fecha).slice(0, 10)}.csv`;
}

// ---------- Recursos CAPCEE (módulo futuro) ----------
/**
 * Entrega un presupuesto guardado al módulo de asignación por fuente de financiamiento y
 * priorización ("Recursos CAPCEE"), que todavía no existe. Ese módulo deberá:
 *   1. Pedir GET /api/presupuestos?recursos=1 para listar los marcados.
 *   2. Usar este objeto: montos por capítulo y por partida genérica (lo que se asigna a
 *      una fuente), total con IVA y si hay precios estimados (para no comprometer recursos
 *      con montos sin validar).
 * No modifica el presupuesto: solo lo describe.
 */
export function paraRecursosCapcee(p) {
  return {
    presupuestoId: p.id,
    obra: p.obra,
    cct: p.cct,
    fecha: p.fecha,
    huellaTabulador: p.tabulador?.huella || null,
    porCapitulo: p.desglose.map((c) => ({ capitulo: c.capitulo, importe: c.importe })),
    porPartidaGenerica: p.desglose.flatMap((c) => c.genericas.map((g) => ({ capitulo: c.capitulo, partida: g.partida, importe: g.importe }))),
    subtotal: p.subtotal,
    iva: p.iva,
    total: p.total,
    requiereValidacion: p.hayEstimados,
    marcadoEn: p.recursosCapcee,
  };
}
