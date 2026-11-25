// Cálculo de presupuestos de obra escolar con el tabulador CAPCEE.
// Toda la aritmética vive aquí (no en la interfaz) para poder probarla.
//
// Reglas:
// - Importe de un renglón = cantidad × precio × factor del concepto (CSV) × factor del presupuesto,
//   redondeado a 2 decimales por renglón.
// - Los conceptos con unidad "%" se calculan sobre la BASE DE OBRA: la suma de los importes ya
//   ajustados de los conceptos del capítulo 6000 que no son "%". No se les aplica ningún factor y
//   no entran en la base (no hay cálculo circular). Llevan cantidad 1.
// - Subtotal = suma de importes redondeados. IVA 16 % en línea aparte; los precios nunca lo incluyen.
import fs from 'node:fs';
import { parseCSV } from './iter.js';

export const TASA_IVA = 0.16;
export const CAPITULO_OBRA = '6000';
export const FACTOR_MIN = 0.01;
export const FACTOR_MAX = 10;
export const AVISO_ESTIMADOS = 'Este presupuesto usa precios estimados; no es un costo oficial';
export const SIN_PARTIDA_ESPECIFICA = 'Pendiente COGAPE';

// Redondeo a centavos que no se equivoca con casos como 1.005.
export const redondear2 = (x) => Math.round((Number(x) + Number.EPSILON) * 100) / 100;

// CCT de Puebla: 21 + tres letras + cuatro dígitos + letra verificadora (ej. 21DPR1273G).
export const RE_CCT_PUEBLA = /^21[A-Z]{3}\d{4}[A-Z]$/;
export function normalizarCCT(v) {
  const cct = String(v ?? '').trim().toUpperCase();
  if (!cct) return { cct: null };
  if (cct.length !== 10) return { error: `El CCT debe tener 10 caracteres (tiene ${cct.length}).` };
  if (!cct.startsWith('21')) return { error: 'El CCT debe empezar con 21 (Puebla).' };
  if (!RE_CCT_PUEBLA.test(cct)) return { error: 'El CCT no tiene el formato esperado, por ejemplo 21DPR1273G.' };
  return { cct };
}

// ---------- Catálogo de planteles (preparado; el archivo aún no existe) ----------
// Cuando exista data/capcee/planteles.csv, con al menos la columna `cct` y de preferencia
// `nombre`, `municipio`, `localidad`, `lat`, `lon`, el presupuesto se enlazará solo con su plantel.
// Mientras no exista, cargarPlanteles devuelve null y buscarPlantel devuelve null.
export function cargarPlanteles(ruta) {
  if (!fs.existsSync(ruta)) return null;
  const filas = parseCSV(fs.readFileSync(ruta, 'utf8').replace(/^﻿/, ''));
  if (filas.length < 2) return null;
  const enc = filas[0].map((h) => h.trim().toLowerCase());
  const iCct = enc.indexOf('cct');
  if (iCct < 0) return null;
  const mapa = new Map();
  for (const f of filas.slice(1)) {
    const cct = String(f[iCct] ?? '').trim().toUpperCase();
    if (cct) mapa.set(cct, Object.fromEntries(enc.map((h, i) => [h, String(f[i] ?? '').trim()])));
  }
  return mapa;
}
export function buscarPlantel(cct, planteles) {
  if (!cct || !planteles) return null;
  return planteles.get(cct) || null;
}

// ---------- Cálculo ----------
export class ErrorPresupuesto extends Error {
  constructor(errores) {
    super(errores.join(' '));
    this.errores = errores;
  }
}

/**
 * @param {{obra:string, cct?:string, factor?:number, renglones:{clave_ref:string, cantidad:number}[]}} entrada
 * @param {object[]} catalogo  conceptos de procesarTabulador()
 * @param {Map|null} planteles  catálogo opcional de planteles
 */
export function calcularPresupuesto(entrada, catalogo, planteles = null) {
  const e = entrada || {};
  const errores = [];

  const obra = String(e.obra ?? '').trim().slice(0, 120);
  if (!obra) errores.push('Escribe el nombre de la obra.');
  const c = normalizarCCT(e.cct);
  if (c.error) errores.push(c.error);

  const factorTxt = e.factor === undefined || e.factor === null || e.factor === '' ? 1 : e.factor;
  const factor = Number(factorTxt);
  if (!Number.isFinite(factor) || factor < FACTOR_MIN || factor > FACTOR_MAX) {
    errores.push(`El factor del presupuesto debe ser un número entre ${FACTOR_MIN} y ${FACTOR_MAX}.`);
  }

  const porClave = new Map(catalogo.map((x) => [x.clave_ref, x]));
  const lista = Array.isArray(e.renglones) ? e.renglones : [];
  const vistas = new Set();
  const validos = [];
  lista.forEach((r, i) => {
    const n = i + 1;
    const clave = String(r?.clave_ref ?? '').trim();
    const concepto = porClave.get(clave);
    if (!concepto) { errores.push(`Renglón ${n}: el concepto "${clave}" no está en el tabulador.`); return; }
    if (vistas.has(clave)) { errores.push(`Renglón ${n}: ${clave} ya está en el presupuesto.`); return; }
    vistas.add(clave);
    const cantidad = Number(r.cantidad);
    if (!Number.isFinite(cantidad) || cantidad <= 0) { errores.push(`Renglón ${n} (${clave}): la cantidad debe ser mayor que 0.`); return; }
    if (concepto.unidad === '%' && cantidad !== 1) { errores.push(`Renglón ${n} (${clave}): los conceptos en % llevan cantidad 1.`); return; }
    validos.push({ concepto, cantidad });
  });
  if (errores.length) throw new ErrorPresupuesto(errores);

  // 1) Conceptos con unidad: cantidad × precio × factor del concepto × factor del presupuesto.
  const renglones = [];
  for (const { concepto: k, cantidad } of validos) {
    if (k.unidad === '%') continue;
    renglones.push(armarRenglon(k, cantidad, redondear2(cantidad * k.precio * k.factor_regional * factor), { factor }));
  }
  // 2) Base de obra: capítulo 6000, ya ajustada, sin conceptos %.
  const baseObra = redondear2(renglones.filter((r) => r.capitulo === CAPITULO_OBRA).reduce((a, r) => a + r.importe, 0));
  // 3) Conceptos %: porcentaje de la base, sin factores.
  for (const { concepto: k, cantidad } of validos) {
    if (k.unidad !== '%') continue;
    renglones.push(armarRenglon(k, cantidad, redondear2((baseObra * k.precio) / 100), { porcentajeDeBase: baseObra }));
  }
  // Conserva el orden en que se agregaron.
  const orden = new Map(validos.map((v, i) => [v.concepto.clave_ref, i]));
  renglones.sort((a, b) => orden.get(a.clave_ref) - orden.get(b.clave_ref));

  const subtotal = redondear2(renglones.reduce((a, r) => a + r.importe, 0));
  const iva = redondear2(subtotal * TASA_IVA);
  const total = redondear2(subtotal + iva);
  const hayEstimados = renglones.some((r) => r.tipo_dato === 'ESTIMADO');

  return {
    obra,
    cct: c.cct || null,
    plantel: buscarPlantel(c.cct, planteles),
    factor_presupuesto: factor,
    renglones,
    baseObra,
    subtotal,
    tasaIva: TASA_IVA,
    iva,
    total,
    hayEstimados,
    aviso: hayEstimados ? AVISO_ESTIMADOS : null,
    desglose: desglosar(renglones),
  };
}

function armarRenglon(k, cantidad, importe, { factor = null, porcentajeDeBase = null }) {
  return {
    clave_ref: k.clave_ref,
    concepto: k.concepto,
    unidad: k.unidad,
    cantidad,
    precio: k.precio,
    // En los conceptos % los factores no aplican: se dejan en null para que el desglose lo muestre así.
    factor_concepto: k.unidad === '%' ? null : k.factor_regional,
    factor_presupuesto: k.unidad === '%' ? null : factor,
    porcentaje_de_base: porcentajeDeBase,
    importe,
    capitulo: k.capitulo,
    partida_generica: k.partida_generica || 'Sin partida genérica',
    partida_especifica: k.partida_especifica || SIN_PARTIDA_ESPECIFICA,
    tipo_dato: k.tipo_dato,
    fuente: k.fuente,
  };
}

// Capítulo → partida genérica → partida específica, con subtotales en cada nivel.
export function desglosar(renglones) {
  const caps = new Map();
  for (const r of renglones) {
    if (!caps.has(r.capitulo)) caps.set(r.capitulo, { capitulo: r.capitulo, importe: 0, genericas: new Map() });
    const c = caps.get(r.capitulo);
    if (!c.genericas.has(r.partida_generica)) c.genericas.set(r.partida_generica, { partida: r.partida_generica, importe: 0, especificas: new Map() });
    const g = c.genericas.get(r.partida_generica);
    if (!g.especificas.has(r.partida_especifica)) g.especificas.set(r.partida_especifica, { partida: r.partida_especifica, importe: 0, claves: [] });
    const s = g.especificas.get(r.partida_especifica);
    s.claves.push(r.clave_ref);
    s.importe += r.importe; g.importe += r.importe; c.importe += r.importe;
  }
  const lista = (m, f) => [...m.values()].map(f);
  return lista(caps, (c) => ({
    capitulo: c.capitulo,
    importe: redondear2(c.importe),
    genericas: lista(c.genericas, (g) => ({
      partida: g.partida,
      importe: redondear2(g.importe),
      especificas: lista(g.especificas, (s) => ({ partida: s.partida, importe: redondear2(s.importe), claves: s.claves })),
    })),
  })).sort((a, b) => a.capitulo.localeCompare(b.capitulo));
}
