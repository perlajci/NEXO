// Lector de escuelas de Puebla (data/escuelas/*.csv).
//
// Acepta dos fuentes públicas y las normaliza al mismo registro:
// - Catálogo de Centros de Trabajo (CCT) de la SEP: trae la clave CCT y, a veces, la matrícula.
// - DENUE del INEGI (actividades 6111, 6112 y 6113: escuelas de educación básica, media,
//   especial, técnica superior y superior): NO trae CCT ni alumnos, así que esos campos quedan vacíos.
//
// Registro normalizado:
//   { id, cct, nombre, nivel, sostenimiento, municipio, localidad, lat, lon, alumnos, fuente, precision }
// - cct: clave de la SEP tal como viene en el archivo (validada con el formato de Puebla), o '' si
//   la fuente no la trae. Nunca se inventa: el `id` interno de una escuela del DENUE es `DENUE-<id>`.
// - alumnos: número del archivo o null si no viene.
// - precision: resolución de la coordenada según cuántos decimales trae el archivo
//   ('alta' ≥ 4 decimales ≈ 11 m, 'media' 3 ≈ 110 m, 'baja' ≤ 2 ≈ 1 km o más). Dice qué tan fino
//   está escrito el dato, no si la escuela está realmente en ese punto.
//
// Las coordenadas deben caer dentro de LIMITES_PUEBLA (rectángulo que contiene al estado); las que
// no, se descartan y se cuentan. Es un filtro grueso: un punto de un estado vecino cerca de la
// frontera puede pasar.
import fs from 'node:fs';
import path from 'node:path';
import { parseCSV, dmsADecimal, numero, leerTexto } from './iter.js';
import { normalizarCCT } from './presupuesto.js';

export const LIMITES_PUEBLA = { latMin: 17.8, latMax: 20.9, lonMin: -99.1, lonMax: -96.7 };
export const dentroDePuebla = (lat, lon) =>
  lat >= LIMITES_PUEBLA.latMin && lat <= LIMITES_PUEBLA.latMax && lon >= LIMITES_PUEBLA.lonMin && lon <= LIMITES_PUEBLA.lonMax;

// Columnas reconocidas (sin acentos, mayúsculas ni espacios/guiones bajos de diferencia).
const CAMPOS = {
  cct: ['cct', 'clave_ct', 'clavect', 'clave_cct', 'cv_cct', 'cve_cct', 'clave_centro_trabajo', 'clave del centro de trabajo'],
  nombre: ['nombre', 'nombre_ct', 'nombrect', 'nombre_escuela', 'c_nombre', 'nombre del centro de trabajo', 'nom_estab'],
  nivel: ['nivel', 'nivel_educativo', 'c_nivel', 'nombre_nivel', 'nivel educativo'],
  sostenimiento: ['sostenimiento', 'c_sostenimiento', 'tipo_sostenimiento', 'control'],
  municipio: ['municipio', 'nombre_municipio', 'nom_mun', 'c_nom_mun', 'nombre del municipio'],
  localidad: ['localidad', 'nombre_localidad', 'nom_loc', 'c_nom_loc', 'nombre de la localidad'],
  lat: ['lat', 'latitud'],
  lon: ['lon', 'lng', 'longitud'],
  alumnos: ['alumnos', 'total_alumnos', 'alumnos_total', 'matricula', 'total de alumnos'],
  fuente: ['fuente'],
  precision: ['precision'],
  // Solo DENUE
  denue_id: ['id'],
  codigo_act: ['codigo_act', 'codigo de la clase de actividad scian'],
  nombre_act: ['nombre_act', 'nombre de clase de la actividad'],
};
const clave = (s) => String(s || '').replace(/^﻿/, '').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/["']/g, '').trim().toLowerCase().replace(/[\s_]+/g, '_');

function mapearEncabezados(encabezados) {
  const norm = encabezados.map(clave);
  const mapa = {};
  for (const [campo, alternos] of Object.entries(CAMPOS)) {
    const i = norm.findIndex((h) => alternos.map(clave).includes(h));
    if (i >= 0) mapa[campo] = i;
  }
  return mapa;
}

const sinAcentos = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// Nivel educativo con nombres parejos; si no se reconoce, se deja el texto original.
export function normalizarNivel(texto) {
  const t = sinAcentos(texto);
  if (!t.trim()) return '';
  if (t.includes('inicial')) return 'Inicial';
  if (t.includes('preescolar')) return 'Preescolar';
  if (t.includes('primaria')) return 'Primaria';
  if (t.includes('secundaria')) return 'Secundaria';
  if (t.includes('media superior') || t.includes('bachillerato') || t.includes('preparatoria') || t.includes('media tecnica')) return 'Media superior';
  if (t.includes('especial')) return 'Especial';
  if (t.includes('combinan') || t.includes('diversos niveles')) return 'Varios niveles';
  if (t.includes('superior') || t.includes('universi') || t.includes('licenciatura') || t.includes('normal')) return 'Superior';
  return String(texto).trim();
}

export function normalizarSostenimiento(texto) {
  const t = sinAcentos(texto);
  if (!t.trim()) return '';
  if (t.includes('privad') || t.includes('particular')) return 'Privado';
  if (t.includes('public') || t.includes('federal') || t.includes('estatal') || t.includes('municipal') || t.includes('autonom')) return 'Público';
  return String(texto).trim();
}

// Resolución de la coordenada escrita en el archivo.
export function precisionCoordenada(latTxt, lonTxt) {
  const dec = (s) => {
    const v = String(s || '').trim();
    if (/[°'"]/.test(v)) { // grados-minutos-segundos: los segundos enteros son ≈ 30 m
      const seg = v.match(/(\d+(?:\.(\d+))?)\s*"/);
      return seg && seg[2] ? 4 : 3;
    }
    const m = v.match(/\.(\d+)/);
    return m ? m[1].length : 0;
  };
  const d = Math.min(dec(latTxt), dec(lonTxt));
  return d >= 4 ? 'alta' : d === 3 ? 'media' : 'baja';
}

const texto = (v, n = 160) => String(v ?? '').trim().replace(/\s+/g, ' ').slice(0, n);

// Convierte el texto de un CSV en escuelas. `archivo` solo se usa en los mensajes.
export function procesarEscuelas(contenido, archivo = 'escuelas.csv') {
  const filas = parseCSV(String(contenido).replace(/^﻿/, ''));
  if (filas.length < 2) throw new Error(`${archivo}: el archivo está vacío`);
  const mapa = mapearEncabezados(filas[0]);
  const esDenue = mapa.codigo_act !== undefined || mapa.nombre_act !== undefined;
  const requeridas = esDenue ? ['nombre', 'lat', 'lon'] : ['cct', 'nombre', 'lat', 'lon'];
  const faltan = requeridas.filter((c) => mapa[c] === undefined);
  if (faltan.length) throw new Error(`${archivo}: faltan columnas: ${faltan.join(', ')}`);

  const escuelas = [];
  const resumen = { filas: filas.length - 1, validas: 0, fueraDePuebla: 0, sinCoordenadas: 0, cctInvalido: 0, noEscolares: 0 };
  const descartes = [];
  const descartar = (fila, motivo, campo) => {
    resumen[campo]++;
    if (descartes.length < 50) descartes.push({ archivo, fila, motivo });
  };

  filas.slice(1).forEach((f, i) => {
    const fila = i + 2; // renglón en Excel (1 = encabezado)
    const get = (c) => (mapa[c] === undefined ? '' : f[mapa[c]] ?? '');

    let cct = '';
    if (!esDenue || mapa.cct !== undefined) {
      const c = normalizarCCT(get('cct'));
      if (c.error || (!esDenue && !c.cct)) return descartar(fila, c.error || 'sin CCT', 'cctInvalido');
      cct = c.cct || '';
    }
    if (esDenue && mapa.codigo_act !== undefined && !/^611[123]/.test(String(get('codigo_act')).trim())) {
      return descartar(fila, `actividad ${texto(get('codigo_act'), 10)} no es escuela`, 'noEscolares');
    }

    const latTxt = get('lat');
    const lonTxt = get('lon');
    const lat = dmsADecimal(latTxt, 'lat');
    const lon = dmsADecimal(lonTxt, 'lon');
    if (lat === null || lon === null) return descartar(fila, 'sin coordenadas', 'sinCoordenadas');
    if (!dentroDePuebla(lat, lon)) return descartar(fila, `coordenadas fuera de Puebla (${lat.toFixed(4)}, ${lon.toFixed(4)})`, 'fueraDePuebla');

    const alumnos = numero(get('alumnos'));
    const descripcionAct = get('nombre_act');
    escuelas.push({
      id: cct || (esDenue && texto(get('denue_id'), 20) ? `DENUE-${texto(get('denue_id'), 20)}` : `${archivo}#${fila}`),
      cct,
      nombre: texto(get('nombre')) || 'Sin nombre',
      nivel: normalizarNivel(get('nivel') || descripcionAct),
      sostenimiento: normalizarSostenimiento(get('sostenimiento') || descripcionAct),
      municipio: texto(get('municipio'), 80),
      localidad: texto(get('localidad'), 120),
      lat: Math.round(lat * 1e6) / 1e6,
      lon: Math.round(lon * 1e6) / 1e6,
      alumnos: alumnos !== null && alumnos >= 0 ? Math.round(alumnos) : null,
      fuente: texto(get('fuente'), 80) || (esDenue ? 'DENUE (INEGI)' : 'Catálogo CCT (SEP)'),
      precision: ['alta', 'media', 'baja'].includes(sinAcentos(get('precision')).trim()) ? sinAcentos(get('precision')).trim() : precisionCoordenada(latTxt, lonTxt),
    });
    resumen.validas++;
  });
  return { escuelas, resumen, descartes, formato: esDenue ? 'DENUE' : 'SEP' };
}

// Lee todos los CSV de la carpeta. Devuelve null si no hay ninguno (la sección muestra un aviso).
// Un archivo con error no detiene a los demás: se reporta en `errores`.
// Si una escuela aparece repetida (misma CCT o mismo id del DENUE), se queda la primera.
export function cargarEscuelasDesdeCarpeta(carpeta) {
  if (!fs.existsSync(carpeta)) return null;
  const archivos = fs.readdirSync(carpeta).filter((a) => a.toLowerCase().endsWith('.csv')).sort();
  if (!archivos.length) return null;
  const vistas = new Set();
  const escuelas = [];
  const resumen = { archivos: [], filas: 0, validas: 0, fueraDePuebla: 0, sinCoordenadas: 0, cctInvalido: 0, noEscolares: 0, repetidas: 0, porFuente: {} };
  const descartes = [];
  const errores = [];
  for (const a of archivos) {
    let r;
    try { r = procesarEscuelas(leerTexto(path.join(carpeta, a)), a); } catch (e) { errores.push(e.message); continue; }
    resumen.archivos.push({ archivo: a, formato: r.formato, filas: r.resumen.filas, validas: r.resumen.validas });
    for (const k of ['filas', 'fueraDePuebla', 'sinCoordenadas', 'cctInvalido', 'noEscolares']) resumen[k] += r.resumen[k];
    descartes.push(...r.descartes);
    for (const e of r.escuelas) {
      if (vistas.has(e.id)) { resumen.repetidas++; continue; }
      vistas.add(e.id);
      escuelas.push(e);
      resumen.porFuente[e.fuente] = (resumen.porFuente[e.fuente] || 0) + 1;
    }
  }
  resumen.validas = escuelas.length;
  return { escuelas, resumen, descartes: descartes.slice(0, 50), errores };
}

// Huella barata de la carpeta (nombres, tamaños y fechas de los CSV) para recargar solo si cambió.
export function marcaCarpeta(carpeta) {
  try {
    return fs.readdirSync(carpeta).filter((a) => a.toLowerCase().endsWith('.csv')).sort()
      .map((a) => { const s = fs.statSync(path.join(carpeta, a)); return `${a}:${s.size}:${s.mtimeMs}`; }).join('|') || 'vacia';
  } catch { return 'sin-carpeta'; }
}
