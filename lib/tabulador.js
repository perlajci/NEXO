// Tabulador de precios de referencia para obra escolar (CAPCEE Puebla).
// Lee data/capcee/tabulador.csv (UTF-8 con BOM), valida cada fila y nunca
// inventa datos: una fila con precio, unidad o tipo inválidos se descarta y se
// reporta en `rechazados` con el motivo, para que la persona la corrija en el CSV.
import fs from 'node:fs';
import { parseCSV } from './iter.js';

export const COLUMNAS = [
  'clave_ref', 'concepto', 'unidad', 'precio_unitario_mxn_sin_iva', 'capitulo',
  'partida_generica_conac', 'partida_especifica_cogape', 'factor_regional', 'tipo_dato', 'fuente',
];
export const UNIDADES = ['m2', 'm3', 'm', 'pza', 'juego', 'plantel', '%'];
export const TIPOS_DATO = ['OFICIAL CAPCEE', 'REFERENCIA PÚBLICA', 'ESTIMADO'];
export const CAPITULOS = ['2000', '3000', '5000', '6000'];

const sinAcentos = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '');
const clave = (s) => sinAcentos(s).replace(/^﻿/, '').trim().toLowerCase();
// "Referencia publica", "REFERENCIA PÚBLICA" y "referencia pública" son el mismo tipo.
const TIPO_POR_CLAVE = Object.fromEntries(TIPOS_DATO.map((t) => [clave(t), t]));

// Número con punto decimal; acepta separador de miles con coma ("16,000.50").
function numeroPositivo(v) {
  const s = String(v ?? '').trim().replace(/,/g, '');
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return n > 0 ? n : null;
}

// Convierte el texto del CSV en conceptos validados. Lanza un error solo si el
// archivo completo no sirve (vacío o sin alguna columna obligatoria).
export function procesarTabulador(texto) {
  const filas = parseCSV(String(texto ?? '').replace(/^﻿/, ''));
  if (filas.length < 2) throw new Error('El tabulador está vacío: no tiene conceptos debajo de los encabezados.');
  const enc = filas[0].map(clave);
  const idx = Object.fromEntries(COLUMNAS.map((c) => [c, enc.indexOf(c)]));
  const faltan = COLUMNAS.filter((c) => idx[c] < 0);
  if (faltan.length) throw new Error(`Al tabulador le faltan columnas: ${faltan.join(', ')}.`);

  const conceptos = [];
  const rechazados = [];
  const vistas = new Set();
  filas.slice(1).forEach((f, i) => {
    const fila = i + 2; // número de renglón como se ve en Excel (1 = encabezados)
    const get = (c) => String(f[idx[c]] ?? '').trim();
    const clave_ref = get('clave_ref');
    const motivos = [];
    if (!clave_ref) motivos.push('sin clave_ref');
    else if (vistas.has(clave_ref)) motivos.push(`clave_ref repetida (${clave_ref})`);
    if (!get('concepto')) motivos.push('sin concepto');
    const unidad = get('unidad');
    if (!UNIDADES.includes(unidad)) motivos.push(`unidad desconocida "${unidad}" (se aceptan: ${UNIDADES.join(', ')})`);
    const precio = numeroPositivo(get('precio_unitario_mxn_sin_iva'));
    if (precio === null) motivos.push(`precio inválido "${get('precio_unitario_mxn_sin_iva')}" (debe ser un número mayor que 0)`);
    const capitulo = get('capitulo');
    if (!/^\d{4}$/.test(capitulo)) motivos.push(`capítulo inválido "${capitulo}" (cuatro dígitos, p. ej. 6000)`);
    // Factor vacío = 1 (sin ajuste regional). Si trae valor, debe ser un número mayor que 0.
    const factorTxt = get('factor_regional');
    const factor = factorTxt === '' ? 1 : numeroPositivo(factorTxt);
    if (factor === null) motivos.push(`factor_regional inválido "${factorTxt}"`);
    const tipo = TIPO_POR_CLAVE[clave(get('tipo_dato'))];
    if (!tipo) motivos.push(`tipo_dato desconocido "${get('tipo_dato')}" (se aceptan: ${TIPOS_DATO.join(', ')})`);

    if (motivos.length) { rechazados.push({ fila, clave_ref: clave_ref || null, motivos }); return; }
    vistas.add(clave_ref);
    conceptos.push({
      clave_ref,
      concepto: get('concepto'),
      unidad,
      precio,
      capitulo,
      partida_generica: get('partida_generica_conac'),
      partida_especifica: get('partida_especifica_cogape'), // vacía = pendiente de COGAPE
      factor_regional: factor,
      tipo_dato: tipo,
      fuente: get('fuente'),
    });
  });
  return { conceptos, rechazados };
}

// Lee el archivo y nunca lanza: devuelve { ok, error } para que el servidor siga en pie.
export function leerTabulador(ruta) {
  if (!fs.existsSync(ruta)) {
    return { ok: false, error: 'No se encontró el tabulador.', ayuda: 'Copia el CSV en data/capcee/tabulador.csv (ver README).' };
  }
  try {
    const r = procesarTabulador(fs.readFileSync(ruta, 'utf8'));
    return { ok: true, ...r, actualizado: fs.statSync(ruta).mtime.toISOString() };
  } catch (e) {
    return { ok: false, error: e.message, ayuda: `Revisa los encabezados del CSV: ${COLUMNAS.join(', ')}.` };
  }
}

// Filtro por texto (sin distinguir acentos ni mayúsculas), capítulo y tipo de dato.
export function filtrarTabulador(conceptos, { buscar, capitulo, tipo } = {}) {
  const palabras = clave(buscar).split(/\s+/).filter(Boolean);
  const tipoCanon = tipo ? TIPO_POR_CLAVE[clave(tipo)] : null;
  return conceptos.filter((c) => {
    if (capitulo && c.capitulo !== String(capitulo).trim()) return false;
    if (tipo && c.tipo_dato !== tipoCanon) return false;
    if (palabras.length) {
      const texto = clave([c.clave_ref, c.concepto, c.partida_generica, c.partida_especifica].join(' '));
      if (!palabras.every((p) => texto.includes(p))) return false;
    }
    return true;
  });
}

// Cuántos conceptos hay por capítulo y por tipo de dato.
export function resumenTabulador(conceptos) {
  const porCapitulo = {};
  const porTipo = Object.fromEntries(TIPOS_DATO.map((t) => [t, 0]));
  for (const c of conceptos) {
    porCapitulo[c.capitulo] = (porCapitulo[c.capitulo] || 0) + 1;
    porTipo[c.tipo_dato]++;
  }
  return { total: conceptos.length, porCapitulo, porTipo };
}
