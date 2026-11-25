// Lector del ITER (Principales resultados por localidad, Censo 2020, INEGI).
// Acepta el CSV de datos abiertos (encabezados con mnemónicos) y el exportado
// desde SCITEL (encabezados descriptivos). Convierte LONGITUD/LATITUD de
// grados-minutos-segundos a decimal y respeta los valores reservados (*) y N/D.
import fs from 'node:fs';
import path from 'node:path';

// Campos que usa NEXO. Cada uno con su mnemónico y nombres descriptivos alternos.
export const CAMPOS = {
  ENTIDAD: ['clave de entidad federativa', 'entidad'],
  NOM_ENT: ['nombre de la entidad', 'nom_ent'],
  MUN: ['clave de municipio o demarcacion territorial', 'mun'],
  NOM_MUN: ['nombre del municipio o demarcacion territorial', 'nom_mun'],
  LOC: ['clave de localidad', 'loc'],
  NOM_LOC: ['nombre de la localidad', 'nom_loc'],
  LONGITUD: ['longitud'],
  LATITUD: ['latitud'],
  ALTITUD: ['altitud'],
  POBTOT: ['poblacion total', 'pobtot'],
  POBFEM: ['poblacion femenina', 'pobfem'],
  POBMAS: ['poblacion masculina', 'pobmas'],
  P_0A2: ['poblacion de 0 a 2 anos', 'p_0a2'],
  P_60YMAS: ['poblacion de 60 anos y mas', 'p_60ymas'],
  PCON_DISC: ['poblacion con discapacidad', 'pcon_disc'],
  P3YM_HLI: ['poblacion de 3 anos y mas que habla alguna lengua indigena', 'p3ym_hli'],
  PSINDER: ['poblacion sin afiliacion a servicios de salud', 'psinder'],
  TVIVHAB: ['total de viviendas habitadas', 'tvivhab'],
  VPH_PISOTI: ['viviendas particulares habitadas con piso de tierra', 'vph_pisoti'],
  VPH_S_ELEC: ['viviendas particulares habitadas que no disponen de energia electrica', 'vph_s_elec'],
  VPH_AGUAFV: [
    'viviendas particulares habitadas que no disponen de agua entubada en el ambito de la vivienda',
    'vph_aguafv',
  ],
};

// Indicadores numéricos que se suman en una geocerca.
export const INDICADORES = [
  'POBTOT', 'POBFEM', 'POBMAS', 'P_0A2', 'P_60YMAS', 'PCON_DISC', 'P3YM_HLI', 'PSINDER',
  'TVIVHAB', 'VPH_PISOTI', 'VPH_S_ELEC', 'VPH_AGUAFV',
];

const normalizar = (s) =>
  String(s || '')
    .replace(/^﻿/, '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/["']/g, '')
    .trim()
    .toLowerCase();

// Parser CSV con soporte de comillas y comas dentro de campos.
export function parseCSV(texto) {
  const filas = [];
  let fila = [];
  let campo = '';
  let enComillas = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (enComillas) {
      if (c === '"') {
        if (texto[i + 1] === '"') { campo += '"'; i++; } else enComillas = false;
      } else campo += c;
    } else if (c === '"') enComillas = true;
    else if (c === ',') { fila.push(campo); campo = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && texto[i + 1] === '\n') i++;
      fila.push(campo); campo = '';
      if (fila.length > 1 || fila[0] !== '') filas.push(fila);
      fila = [];
    } else campo += c;
  }
  if (campo !== '' || fila.length) { fila.push(campo); filas.push(fila); }
  return filas;
}

// "98°12'34.567\" W" -> -98.209602 ; también acepta decimal y DMS compacto (0981234.567).
export function dmsADecimal(valor, tipo) {
  if (valor === undefined || valor === null) return null;
  const s = String(valor).trim();
  if (!s || s === '*' || /^n\/?d$/i.test(s)) return null;
  const hemi = (s.match(/[NSEW]\s*$/i) || [''])[0].trim().toUpperCase();
  const negativo = hemi === 'W' || hemi === 'S' || s.startsWith('-');
  const partes = s.match(/\d+(?:\.\d+)?/g);
  if (!partes) return null;
  let dec;
  if (partes.length >= 3) {
    dec = Number(partes[0]) + Number(partes[1]) / 60 + Number(partes[2]) / 3600;
  } else {
    const n = Math.abs(Number(partes.join('.')));
    const limite = tipo === 'lat' ? 90 : 180;
    if (n <= limite) dec = n;
    else {
      // DMS compacto: GGGMMSS.sss
      const [ent, frac = ''] = s.replace(/[^\d.]/g, '').split('.');
      const ss = Number(`${ent.slice(-2)}.${frac || 0}`);
      const mm = Number(ent.slice(-4, -2));
      const gg = Number(ent.slice(0, -4));
      dec = gg + mm / 60 + ss / 3600;
    }
  }
  if (!Number.isFinite(dec)) return null;
  // En México la longitud siempre es oeste.
  if (tipo === 'lon') return -Math.abs(dec);
  return negativo ? -Math.abs(dec) : dec;
}

export function numero(v) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  if (s === '' || s === '*' || /^n\/?d$/i.test(s)) return null;
  const n = Number(s.replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

function mapearEncabezados(encabezados) {
  const norm = encabezados.map(normalizar);
  const mapa = {};
  for (const [clave, alternos] of Object.entries(CAMPOS)) {
    const candidatos = [normalizar(clave), ...alternos.map(normalizar)];
    const idx = norm.findIndex((h) => candidatos.includes(h));
    if (idx >= 0) mapa[clave] = idx;
  }
  return mapa;
}

export function leerTexto(ruta) {
  const buf = fs.readFileSync(ruta);
  const utf8 = buf.toString('utf8');
  // Si hay caracteres de reemplazo, el archivo viene en Latin-1 / Windows-1252.
  return utf8.includes('�') ? buf.toString('latin1') : utf8;
}

// Convierte el texto del ITER en una lista de localidades con coordenadas.
export function procesarITER(texto) {
  const filas = parseCSV(texto);
  if (filas.length < 2) throw new Error('El archivo ITER está vacío');
  const mapa = mapearEncabezados(filas[0]);
  const faltan = ['MUN', 'LOC', 'LONGITUD', 'LATITUD', 'POBTOT'].filter((c) => mapa[c] === undefined);
  if (faltan.length) throw new Error(`Faltan columnas en el ITER: ${faltan.join(', ')}`);

  const localidades = [];
  const resumen = { filas: filas.length - 1, sinCoordenadas: 0, totalesOmitidos: 0, poblacionSinCoordenadas: 0 };
  for (const f of filas.slice(1)) {
    const get = (c) => (mapa[c] === undefined ? undefined : f[mapa[c]]);
    const mun = String(get('MUN') || '').trim().padStart(3, '0');
    const loc = String(get('LOC') || '').trim().padStart(4, '0');
    // Totales nacionales, estatales, municipales y acumulados de localidades de 1 y 2 viviendas.
    if (mun === '000' || ['0000', '9998', '9999'].includes(loc)) { resumen.totalesOmitidos++; continue; }
    const lat = dmsADecimal(get('LATITUD'), 'lat');
    const lon = dmsADecimal(get('LONGITUD'), 'lon');
    const pob = numero(get('POBTOT'));
    if (lat === null || lon === null) {
      resumen.sinCoordenadas++;
      resumen.poblacionSinCoordenadas += pob || 0;
      continue;
    }
    const l = {
      id: `${String(get('ENTIDAD') || '').trim().padStart(2, '0')}${mun}${loc}`,
      ent: String(get('ENTIDAD') || '').trim().padStart(2, '0'),
      mun,
      nomMun: String(get('NOM_MUN') || '').trim(),
      nom: String(get('NOM_LOC') || '').trim(),
      lat: Math.round(lat * 1e6) / 1e6,
      lon: Math.round(lon * 1e6) / 1e6,
      alt: numero(get('ALTITUD')),
    };
    for (const c of INDICADORES) l[c] = numero(get(c));
    localidades.push(l);
  }
  return { localidades, resumen };
}

// Carga el primer CSV que encuentre en la carpeta indicada.
export function cargarITERDesdeCarpeta(carpeta) {
  if (!fs.existsSync(carpeta)) return null;
  const archivos = fs.readdirSync(carpeta).filter((a) => a.toLowerCase().endsWith('.csv')).sort();
  if (!archivos.length) return null;
  const todas = [];
  const resumen = { archivos: [], filas: 0, sinCoordenadas: 0, totalesOmitidos: 0, poblacionSinCoordenadas: 0 };
  for (const a of archivos) {
    const r = procesarITER(leerTexto(path.join(carpeta, a)));
    todas.push(...r.localidades);
    resumen.archivos.push(a);
    for (const k of ['filas', 'sinCoordenadas', 'totalesOmitidos', 'poblacionSinCoordenadas']) resumen[k] += r.resumen[k];
  }
  return { localidades: todas, resumen };
}

// Suma indicadores. Los valores reservados (*) no se inventan: se reporta
// cuánta población vive en localidades donde ese indicador está reservado.
export function agregar(localidades) {
  const total = { localidades: localidades.length };
  const reservado = {};
  for (const c of INDICADORES) { total[c] = 0; reservado[c] = 0; }
  for (const l of localidades) {
    for (const c of INDICADORES) {
      if (l[c] === null || l[c] === undefined) reservado[c] += c === 'POBTOT' ? 0 : l.POBTOT || 0;
      else total[c] += l[c];
    }
  }
  return { total, poblacionConDatoReservado: reservado };
}
