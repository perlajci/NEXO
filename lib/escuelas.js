// Lector de escuelas de Puebla (data/escuelas/*.csv).
//
// Acepta dos fuentes públicas y las normaliza al mismo registro:
// - Catálogo de Centros de Trabajo (CCT) de la SEP: trae la clave CCT y, a veces, la matrícula.
// - DENUE del INEGI (actividades 6111, 6112 y 6113: escuelas de educación básica, media,
//   especial, técnica superior y superior): NO trae CCT ni alumnos, así que esos campos quedan vacíos.
//
// Registro normalizado:
//   { id, cct, nombre, nivel, sostenimiento, municipio, localidad, lat, lon, alumnos, turnos,
//     fuente, decimales_coord }
// - cct: clave de la SEP tal como viene en el archivo (validada con el formato de Puebla), o '' si
//   la fuente no la trae. Nunca se inventa: el `id` interno de una escuela del DENUE es `DENUE-<id>`.
// - alumnos: número del archivo o null si no viene. Si la CCT viene en varios renglones (uno por
//   turno), queda un solo registro con la suma de los alumnos y la lista de `turnos`.
// - decimales_coord: qué tan fino está escrita la coordenada en el archivo
//   ('alta' ≥ 4 decimales ≈ 11 m, 'media' 3 ≈ 110 m, 'baja' ≤ 2 ≈ 1 km o más). No dice si la
//   escuela está realmente en ese punto.
//
// Filtros, en este orden:
// 1. Clave de entidad = 21 (columna de entidad del archivo). Si el archivo no la trae, se usa el
//    inicio de la CCT (21 = Puebla) y, en el DENUE sin entidad, solo el rectángulo.
// 2. CCT con formato de Puebla (solo SEP).
// 3. Coordenadas presentes.
// 4. Revisión extra: entidad 21 pero coordenadas fuera de LIMITES_PUEBLA (rectángulo que contiene
//    al estado) → se descarta y se cuenta aparte, porque la coordenada está mal.
import fs from 'node:fs';
import path from 'node:path';
import { parseCSV, dmsADecimal, numero, leerTexto } from './iter.js';
import { normalizarCCT } from './presupuesto.js';

export const ENTIDAD_PUEBLA = '21';
export const LIMITES_PUEBLA = { latMin: 17.8, latMax: 20.9, lonMin: -99.1, lonMax: -96.7 };
export const dentroDePuebla = (lat, lon) =>
  lat >= LIMITES_PUEBLA.latMin && lat <= LIMITES_PUEBLA.latMax && lon >= LIMITES_PUEBLA.lonMin && lon <= LIMITES_PUEBLA.lonMax;

// Columnas reconocidas (sin acentos, mayúsculas ni espacios/guiones bajos de diferencia).
const CAMPOS = {
  entidad: ['cve_ent', 'cv_ent', 'clave_entidad', 'cve_entidad', 'id_entidad', 'entidad', 'clave de entidad federativa'],
  cct: ['cct', 'clave_ct', 'clavect', 'clave_cct', 'cv_cct', 'cve_cct', 'clave_centro_trabajo', 'clave del centro de trabajo'],
  nombre: ['nombre', 'nombre_ct', 'nombrect', 'nombre_escuela', 'c_nombre', 'nombre del centro de trabajo', 'nom_estab'],
  nivel: ['nivel', 'nivel_educativo', 'c_nivel', 'nombre_nivel', 'nivel educativo'],
  sostenimiento: ['sostenimiento', 'c_sostenimiento', 'tipo_sostenimiento', 'control'],
  turno: ['turno', 'c_turno', 'nombre_turno', 'turno_nombre'],
  municipio: ['municipio', 'nombre_municipio', 'nom_mun', 'c_nom_mun', 'nombre del municipio'],
  localidad: ['localidad', 'nombre_localidad', 'nom_loc', 'c_nom_loc', 'nombre de la localidad'],
  lat: ['lat', 'latitud'],
  lon: ['lon', 'lng', 'longitud'],
  alumnos: ['alumnos', 'total_alumnos', 'alumnos_total', 'matricula', 'total de alumnos'],
  fuente: ['fuente'],
  decimales_coord: ['decimales_coord'],
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
  const usados = new Set(Object.values(mapa));
  const noReconocidas = encabezados.map((h, i) => [String(h).replace(/^﻿/, '').trim(), i]).filter(([h, i]) => h && !usados.has(i)).map(([h]) => h);
  return { mapa, noReconocidas };
}

const sinAcentos = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// Clave de entidad de dos dígitos. Acepta "21", "21.0" o el nombre ("Puebla"); null si no se entiende.
export function claveEntidad(v) {
  const t = String(v ?? '').trim();
  if (!t) return null;
  if (/^\d{1,2}(\.0+)?$/.test(t)) return String(Math.round(Number(t))).padStart(2, '0');
  return sinAcentos(t).trim() === 'puebla' ? ENTIDAD_PUEBLA : `nombre:${t}`;
}

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

// Qué tan fino está escrita la coordenada en el archivo (manda la menos fina de las dos).
export function decimalesCoord(latTxt, lonTxt) {
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
const MOTIVOS = ['otraEntidad', 'cctInvalido', 'sinCoordenadas', 'coordFueraDePuebla', 'noEscolares'];

// Convierte el texto de un CSV en escuelas (un registro por renglón; los turnos se unen al cargar la carpeta).
export function procesarEscuelas(contenido, archivo = 'escuelas.csv') {
  const filas = parseCSV(String(contenido).replace(/^﻿/, ''));
  if (filas.length < 2) throw new Error(`${archivo}: el archivo está vacío`);
  const { mapa, noReconocidas } = mapearEncabezados(filas[0]);
  const esDenue = mapa.codigo_act !== undefined || mapa.nombre_act !== undefined;
  const requeridas = esDenue ? ['nombre', 'lat', 'lon'] : ['cct', 'nombre', 'lat', 'lon'];
  const faltan = requeridas.filter((c) => mapa[c] === undefined);
  if (faltan.length) throw new Error(`${archivo}: faltan columnas: ${faltan.join(', ')}`);

  const escuelas = [];
  const resumen = { filas: filas.length - 1, validas: 0, ...Object.fromEntries(MOTIVOS.map((m) => [m, 0])) };
  const descartes = [];
  const descartar = (fila, motivo, campo) => {
    resumen[campo]++;
    if (descartes.length < 50) descartes.push({ archivo, fila, motivo });
  };
  const columnas = {
    formato: esDenue ? 'DENUE' : 'SEP',
    reconocidas: Object.fromEntries(Object.entries(mapa).map(([c, i]) => [c, String(filas[0][i]).replace(/^﻿/, '').trim()])),
    noReconocidas,
    entidad: mapa.entidad !== undefined,
    latLon: mapa.lat !== undefined && mapa.lon !== undefined,
    alumnos: mapa.alumnos !== undefined,
    turno: mapa.turno !== undefined,
  };

  filas.slice(1).forEach((f, i) => {
    const fila = i + 2; // renglón en Excel (1 = encabezado)
    const get = (c) => (mapa[c] === undefined ? '' : f[mapa[c]] ?? '');

    if (columnas.entidad) {
      const ent = claveEntidad(get('entidad'));
      if (ent !== ENTIDAD_PUEBLA) return descartar(fila, `entidad ${texto(get('entidad'), 30) || 'vacía'}, no Puebla (21)`, 'otraEntidad');
    }
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
    if (!dentroDePuebla(lat, lon)) return descartar(fila, `entidad 21 pero coordenadas fuera de Puebla (${lat.toFixed(4)}, ${lon.toFixed(4)})`, 'coordFueraDePuebla');

    const alumnos = numero(get('alumnos'));
    const descripcionAct = get('nombre_act');
    const dc = sinAcentos(get('decimales_coord')).trim();
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
      turnos: columnas.turno ? [texto(get('turno'), 40) || 'sin turno'] : [],
      fuente: texto(get('fuente'), 80) || (esDenue ? 'DENUE (INEGI)' : 'Catálogo CCT (SEP)'),
      decimales_coord: ['alta', 'media', 'baja'].includes(dc) ? dc : decimalesCoord(latTxt, lonTxt),
    });
    resumen.validas++;
  });
  return { escuelas, resumen, descartes, formato: columnas.formato, columnas };
}

// Une un renglón más de la misma escuela. Un turno nuevo suma sus alumnos; el mismo turno otra vez
// (o la misma escuela del DENUE) es un renglón repetido y no se suma.
function unirTurno(base, otra) {
  const turno = otra.turnos[0];
  if (!turno || base.turnos.includes(turno)) return false;
  base.turnos.push(turno);
  if (otra.alumnos !== null) { base.alumnos = (base.alumnos ?? 0) + otra.alumnos; base._con++; } else base._sin++;
  return true;
}

// Lee todos los CSV de la carpeta. Devuelve null si no hay ninguno (la sección muestra un aviso).
// Un archivo con error no detiene a los demás: se reporta en `errores`.
export function cargarEscuelasDesdeCarpeta(carpeta) {
  if (!fs.existsSync(carpeta)) return null;
  const archivos = fs.readdirSync(carpeta).filter((a) => a.toLowerCase().endsWith('.csv')).sort();
  if (!archivos.length) return null;
  const porId = new Map();
  const resumen = { archivos: [], filas: 0, validas: 0, ...Object.fromEntries(MOTIVOS.map((m) => [m, 0])), turnosUnidos: 0, repetidas: 0, porFuente: {} };
  const descartes = [];
  const errores = [];
  for (const a of archivos) {
    let r;
    try { r = procesarEscuelas(leerTexto(path.join(carpeta, a)), a); } catch (e) { errores.push(e.message); continue; }
    resumen.archivos.push({ archivo: a, filas: r.resumen.filas, validas: r.resumen.validas, ...r.columnas });
    for (const k of ['filas', ...MOTIVOS]) resumen[k] += r.resumen[k];
    descartes.push(...r.descartes);
    for (const e of r.escuelas) {
      const base = porId.get(e.id);
      if (!base) { porId.set(e.id, { ...e, turnos: [...e.turnos], _con: e.alumnos === null ? 0 : 1, _sin: e.alumnos === null ? 1 : 0 }); continue; }
      if (unirTurno(base, e)) resumen.turnosUnidos++; else resumen.repetidas++;
    }
  }
  // alumnos_incompleto: algunos turnos traen matrícula y otros no (la suma es un mínimo).
  const escuelas = [...porId.values()].map(({ _con, _sin, ...e }) => (_con && _sin ? { ...e, alumnos_incompleto: true } : e));
  for (const e of escuelas) resumen.porFuente[e.fuente] = (resumen.porFuente[e.fuente] || 0) + 1;
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
