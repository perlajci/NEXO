// Lector de escuelas de Puebla (data/escuelas/*.csv).
//
// Reconoce tres formatos y los normaliza al mismo registro:
// - CNCT: Catálogo Nacional de Centros de Trabajo de la SEP (cv_cct, c_nombre, c_tipo,
//   inmueble_*, sostenimiento_*, c_turno_01..03, tiponivelsub_c_servicion1..3). No trae alumnos.
// - SEP genérico: cualquier CSV con columnas cct, nombre, latitud, longitud (y opcionales).
// - DENUE del INEGI (actividades 6111, 6112 y 6113): NO trae CCT ni alumnos.
//
// Registro normalizado:
//   { id, cct, nombre, tipo_ct, es_inmueble_escolar, nivel, nivel_origen, servicion1, servicion2,
//     servicion3, sostenimiento, subcontrol, municipio, localidad, ambito, domicilio, lat, lon,
//     alumnos, turnos, turnos_inactivos, fuente, decimales_coord, ubicacion_aproximada }
// - cct: clave de la SEP tal como viene en el archivo, o '' si la fuente no la trae. Nunca se
//   inventa: el `id` interno de una escuela del DENUE es `DENUE-<id>`.
// - alumnos: número del archivo o null si no viene (el CNCT no lo trae).
// - nivel: uno de NIVELES_ESCOLARES o ''. nivel_origen dice de dónde salió: 'servicion' (columna
//   tiponivelsub_c_servicion2 del CNCT), 'c_tipo' (el tipo de centro lo dice, p. ej. "plantel
//   (media superior)"), 'nivel' (columna nivel de otro CSV), 'nombre_act' (DENUE) o ''.
//   servicion1..3 guardan los valores originales del CNCT.
// - es_inmueble_escolar: false para los centros CONAFE de educación inicial, que pueden funcionar
//   en casas o espacios comunitarios (no entran por defecto a las obras del Tabulador).
// - turnos / turnos_inactivos: los turnos marcados "(inactivo)" van en la segunda lista.
// - "Sin Dato" / "sin dato" se guarda como vacío.
// - decimales_coord: qué tan fino está escrita la coordenada en el archivo
//   ('alta' ≥ 4 decimales ≈ 11 m, 'media' 3 ≈ 110 m, 'baja' ≤ 2 ≈ 1 km o más). No dice si la
//   escuela está realmente en ese punto. ubicacion_aproximada = (decimales_coord === 'baja').
//
// Filtros, en este orden (cada descarte se cuenta y se registra con su renglón y su CCT):
// 1. Entidad Puebla: por clave (21) si el archivo la trae; si no, por nombre de entidad
//    (inmueble_c_nom_ent = "Puebla"); si no trae ninguna, por el inicio "21" de la CCT.
//    Cuando se filtra por nombre, el "21" de la CCT queda como revisión: las que no coinciden se
//    cuentan aparte (cctNoCoincide) pero no se descartan.
// 2. Solo planteles: en el CNCT, c_tipo debe estar en TIPOS_PLANTEL (los demás se cuentan por
//    valor); en el DENUE, actividad 6111–6113.
// 3. CCT con formato válido.
// 4. Coordenadas: vacías, en 0 o fuera del rectángulo de Puebla (LIMITES_PUEBLA) → descarte.
import fs from 'node:fs';
import path from 'node:path';
import { parseCSV, dmsADecimal, numero, leerTexto } from './iter.js';
import { normalizarCCT } from './presupuesto.js';

export const ENTIDAD_PUEBLA = '21';
export const LIMITES_PUEBLA = { latMin: 17.8, latMax: 20.9, lonMin: -99.1, lonMax: -96.7 };
export const dentroDePuebla = (lat, lon) =>
  lat >= LIMITES_PUEBLA.latMin && lat <= LIMITES_PUEBLA.latMax && lon >= LIMITES_PUEBLA.lonMin && lon <= LIMITES_PUEBLA.lonMax;

// Valores de c_tipo (CNCT) donde hay alumnos. Revisados en cnct2026.csv:
// - 'escuela' es el único con nivel educativo en servicion1..3.
// - 'plantel (media superior)': plantel de bachillerato.
// - 'asistencial': albergues escolares, donde duermen niños.
// - CONAFE inicial: pueden funcionar en casas o espacios comunitarios (es_inmueble_escolar = false).
// Los demás (administrativo, supervisión, biblioteca, rectoría, etc.) se descartan y se cuentan
// por valor en resumen.tiposDescartados. Rectoría queda fuera: la universidad ya viene como 'escuela'.
const TIPO_CONAFE = 'centros de apoyo a la educación inicial del conafe';
export const TIPOS_PLANTEL = ['escuela', 'plantel (media superior)', 'asistencial', TIPO_CONAFE];
// Nivel que se toma de c_tipo cuando servicion2 viene vacío.
const NIVEL_POR_TIPO = { 'plantel (media superior)': 'media superior', [TIPO_CONAFE]: 'inicial' };
export const NIVELES_ESCOLARES = ['inicial', 'preescolar', 'primaria', 'secundaria', 'media superior', 'superior', 'especial', 'formación para el trabajo'];

// Columnas reconocidas (sin acentos, mayúsculas ni espacios/guiones bajos de diferencia).
const CAMPOS = {
  entidad: ['cve_ent', 'cv_ent', 'clave_entidad', 'cve_entidad', 'id_entidad', 'entidad', 'clave de entidad federativa'],
  entidad_nombre: ['inmueble_c_nom_ent', 'nom_ent', 'nombre_entidad'],
  cct: ['cct', 'cv_cct', 'clave_ct', 'clavect', 'clave_cct', 'cve_cct', 'clave_centro_trabajo', 'clave del centro de trabajo'],
  nombre: ['nombre', 'c_nombre', 'nombre_ct', 'nombrect', 'nombre_escuela', 'nombre del centro de trabajo', 'nom_estab'],
  tipo_ct: ['c_tipo'],
  nivel: ['nivel', 'nivel_educativo', 'c_nivel', 'nombre_nivel', 'nivel educativo'],
  servicio_1: ['tiponivelsub_c_servicion1'],
  servicio_2: ['tiponivelsub_c_servicion2'],
  servicio_3: ['tiponivelsub_c_servicion3'],
  sostenimiento: ['sostenimiento', 'sostenimiento_c_control', 'c_sostenimiento', 'tipo_sostenimiento', 'control'],
  subcontrol: ['sostenimiento_c_subcontrol', 'subcontrol'],
  turno: ['turno', 'c_turno', 'nombre_turno', 'turno_nombre'],
  turno_1: ['c_turno_01'],
  turno_2: ['c_turno_02'],
  turno_3: ['c_turno_03'],
  municipio: ['municipio', 'inmueble_c_nom_mun', 'nombre_municipio', 'nom_mun', 'c_nom_mun', 'nombre del municipio'],
  localidad: ['localidad', 'inmueble_c_nom_loc', 'nombre_localidad', 'nom_loc', 'c_nom_loc', 'nombre de la localidad'],
  ambito: ['inmueble_c_nom_ambito', 'ambito'],
  vialidad: ['inmueble_c_vialidad_principal', 'vialidad'],
  num_ext: ['inmueble_n_extnum', 'numero_exterior'],
  asentamiento: ['inmueble_c_nom_asen', 'asentamiento', 'colonia'],
  cp: ['inmueble_cv_codigo_postal', 'codigo_postal', 'cp'],
  lat: ['lat', 'latitud', 'inmueble_latitud'],
  lon: ['lon', 'lng', 'longitud', 'inmueble_longitud'],
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
// "Sin Dato", "sin dato", "N/D" o vacío → ''.
export const limpio = (v, n = 160) => {
  const t = String(v ?? '').trim().replace(/\s+/g, ' ');
  return /^(sin dato|n\/?d)$/i.test(t) ? '' : t.slice(0, n);
};

// Clave de entidad de dos dígitos. Acepta "21", "21.0" o el nombre ("Puebla"); null si no se entiende.
export function claveEntidad(v) {
  const t = String(v ?? '').trim();
  if (!t) return null;
  if (/^\d{1,2}(\.0+)?$/.test(t)) return String(Math.round(Number(t))).padStart(2, '0');
  return sinAcentos(t).trim() === 'puebla' ? ENTIDAD_PUEBLA : `nombre:${t}`;
}

// Agrupa un texto de nivel en NIVELES_ESCOLARES; '' si no se reconoce (el original se conserva aparte).
export function normalizarNivel(texto) {
  const t = sinAcentos(texto).trim();
  if (!t) return '';
  if (t.includes('formacion para el trabajo') || t.includes('capacitacion')) return 'formación para el trabajo';
  if (t.includes('inicial') || t.includes('lactante') || t.includes('maternal')) return 'inicial';
  if (t.includes('preescolar')) return 'preescolar';
  if (t.includes('primaria')) return 'primaria';
  if (t.includes('secundaria')) return 'secundaria';
  if (t.includes('media superior') || t.includes('bachillerato') || t.includes('preparatoria') || t.includes('media tecnica') || t.includes('profesional tecnico')) return 'media superior';
  if (t.includes('especial') || t === 'cam' || t.startsWith('cam ')) return 'especial';
  if (t.includes('superior') || t.includes('universi') || t.includes('licenciatura') || t.includes('normal')) return 'superior';
  return '';
}

export function normalizarSostenimiento(texto) {
  const t = sinAcentos(texto);
  if (!t.trim()) return '';
  if (t.includes('privad') || t.includes('particular')) return 'Privado';
  if (t.includes('public') || t.includes('federal') || t.includes('estatal') || t.includes('municipal') || t.includes('autonom')) return 'Público';
  return String(texto).trim();
}

// "1 - matutino" → "matutino"; "sin dato" → ''.
export const limpiarTurno = (v) => limpio(v, 40).replace(/^\d+\s*-\s*/, '');
// Separa los turnos activos de los marcados "(inactivo)" (que se guardan sin esa marca).
export function separarTurnos(lista) {
  const turnos = [];
  const turnosInactivos = [];
  for (const t of lista.filter(Boolean)) {
    if (/\(inactivo\)/i.test(t)) turnosInactivos.push(t.replace(/\s*\(inactivo\)\s*/i, '').trim());
    else turnos.push(t);
  }
  return { turnos, turnosInactivos };
}

// Vialidad + número exterior + asentamiento + código postal. El 0 en número o CP es "sin dato".
export function armarDomicilio({ vialidad, num_ext: numExt, asentamiento, cp }) {
  const calle = [limpio(vialidad, 100), /^0*$/.test(limpio(numExt)) ? '' : limpio(numExt, 10)].filter(Boolean).join(' ');
  const codigo = /^0*$/.test(limpio(cp)) ? '' : `C.P. ${limpio(cp, 5).padStart(5, '0')}`;
  return [calle, limpio(asentamiento, 100), codigo].filter(Boolean).join(', ');
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

const MOTIVOS = ['otraEntidad', 'noEscolares', 'cctInvalido', 'sinCoordenadas', 'coordCero', 'coordFueraDePuebla'];
const MAX_DESCARTES = 2000;

// Convierte el texto de un CSV en escuelas (un registro por renglón; los turnos en renglones
// separados se unen al cargar la carpeta).
export function procesarEscuelas(contenido, archivo = 'escuelas.csv') {
  const filas = parseCSV(String(contenido).replace(/^﻿/, ''));
  if (filas.length < 2) throw new Error(`${archivo}: el archivo está vacío`);
  const { mapa, noReconocidas } = mapearEncabezados(filas[0]);
  const esDenue = mapa.codigo_act !== undefined || mapa.nombre_act !== undefined;
  const esCNCT = !esDenue && (mapa.tipo_ct !== undefined || mapa.servicio_1 !== undefined);
  const requeridas = esDenue ? ['nombre', 'lat', 'lon'] : ['cct', 'nombre', 'lat', 'lon'];
  const faltan = requeridas.filter((c) => mapa[c] === undefined);
  if (faltan.length) throw new Error(`${archivo}: faltan columnas: ${faltan.join(', ')}`);

  const escuelas = [];
  const resumen = { filas: filas.length - 1, validas: 0, ...Object.fromEntries(MOTIVOS.map((m) => [m, 0])), cctNoCoincide: 0, tiposDescartados: {} };
  const descartes = [];
  const descartar = (fila, cct, motivo, campo) => {
    resumen[campo]++;
    if (descartes.length < MAX_DESCARTES) descartes.push({ archivo, fila, cct: limpio(cct, 20).toUpperCase(), motivo });
  };
  const columnas = {
    formato: esDenue ? 'DENUE' : esCNCT ? 'SEP (CNCT)' : 'SEP',
    reconocidas: Object.fromEntries(Object.entries(mapa).map(([c, i]) => [c, String(filas[0][i]).replace(/^﻿/, '').trim()])),
    noReconocidas,
    entidad: mapa.entidad !== undefined ? 'clave' : mapa.entidad_nombre !== undefined ? 'nombre' : null,
    latLon: mapa.lat !== undefined && mapa.lon !== undefined,
    alumnos: mapa.alumnos !== undefined,
    turno: mapa.turno !== undefined || mapa.turno_1 !== undefined,
  };

  filas.slice(1).forEach((f, i) => {
    const fila = i + 2; // renglón en Excel (1 = encabezado)
    const get = (c) => (mapa[c] === undefined ? '' : f[mapa[c]] ?? '');
    const cctTxt = get('cct');

    // 1. Entidad
    if (columnas.entidad === 'clave') {
      if (claveEntidad(get('entidad')) !== ENTIDAD_PUEBLA) return descartar(fila, cctTxt, `entidad ${limpio(get('entidad'), 30) || 'vacía'}, no Puebla (21)`, 'otraEntidad');
    } else if (columnas.entidad === 'nombre') {
      if (claveEntidad(get('entidad_nombre')) !== ENTIDAD_PUEBLA) return descartar(fila, cctTxt, `entidad ${limpio(get('entidad_nombre'), 30) || 'vacía'}, no Puebla`, 'otraEntidad');
      if (!String(cctTxt).trim().startsWith(ENTIDAD_PUEBLA)) resumen.cctNoCoincide++; // revisión, no descarte
    }
    // 2. Solo planteles
    if (esCNCT && mapa.tipo_ct !== undefined) {
      const tipo = limpio(get('tipo_ct'), 80).toLowerCase();
      if (!TIPOS_PLANTEL.includes(tipo)) {
        resumen.tiposDescartados[tipo || '(vacío)'] = (resumen.tiposDescartados[tipo || '(vacío)'] || 0) + 1;
        return descartar(fila, cctTxt, `c_tipo "${tipo || 'vacío'}" no es plantel`, 'noEscolares');
      }
    }
    if (esDenue && mapa.codigo_act !== undefined && !/^611[123]/.test(String(get('codigo_act')).trim())) {
      return descartar(fila, cctTxt, `actividad ${limpio(get('codigo_act'), 10)} no es escuela`, 'noEscolares');
    }
    // 3. CCT (formato de Puebla salvo que la entidad venga por nombre: ahí el "21" es solo revisión)
    let cct = '';
    if (!esDenue || mapa.cct !== undefined) {
      const t = String(cctTxt).trim().toUpperCase();
      if (columnas.entidad === 'nombre') {
        if (!/^\d{2}[A-Z]{3}\d{4}[A-Z]$/.test(t)) return descartar(fila, cctTxt, t ? 'CCT con formato inválido' : 'sin CCT', 'cctInvalido');
        cct = t;
      } else {
        const c = normalizarCCT(cctTxt);
        if (c.error || (!esDenue && !c.cct)) return descartar(fila, cctTxt, c.error || 'sin CCT', 'cctInvalido');
        cct = c.cct || '';
      }
    }
    // 4. Coordenadas
    const latTxt = limpio(get('lat'));
    const lonTxt = limpio(get('lon'));
    const lat = dmsADecimal(latTxt, 'lat');
    const lon = dmsADecimal(lonTxt, 'lon');
    if (lat === null || lon === null) return descartar(fila, cct, 'sin coordenadas', 'sinCoordenadas');
    if (lat === 0 || lon === 0) return descartar(fila, cct, `coordenada en 0 (${latTxt}, ${lonTxt})`, 'coordCero');
    if (!dentroDePuebla(lat, lon)) return descartar(fila, cct, `coordenadas fuera de Puebla (${lat.toFixed(4)}, ${lon.toFixed(4)})`, 'coordFueraDePuebla');

    const alumnos = numero(limpio(get('alumnos')));
    const descripcionAct = get('nombre_act');
    const dc = sinAcentos(get('decimales_coord')).trim();
    const { turnos, turnosInactivos } = separarTurnos(esCNCT
      ? [get('turno_1'), get('turno_2'), get('turno_3')].map(limpiarTurno)
      : columnas.turno ? [limpiarTurno(get('turno')) || 'sin turno'] : []);
    const tipoCt = limpio(get('tipo_ct'), 80).toLowerCase();
    // Nivel agrupado y de dónde salió.
    let nivel = '';
    let nivelOrigen = '';
    if (esCNCT) {
      nivel = normalizarNivel(limpio(get('servicio_2')) || limpio(get('servicio_1')));
      if (nivel) nivelOrigen = 'servicion';
      else if (NIVEL_POR_TIPO[tipoCt]) { nivel = NIVEL_POR_TIPO[tipoCt]; nivelOrigen = 'c_tipo'; }
    } else {
      nivel = normalizarNivel(limpio(get('nivel')) || descripcionAct);
      if (nivel) nivelOrigen = limpio(get('nivel')) ? 'nivel' : 'nombre_act';
    }
    const decimales = ['alta', 'media', 'baja'].includes(dc) ? dc : decimalesCoord(latTxt, lonTxt);
    escuelas.push({
      id: cct || (esDenue && limpio(get('denue_id'), 20) ? `DENUE-${limpio(get('denue_id'), 20)}` : `${archivo}#${fila}`),
      cct,
      nombre: limpio(get('nombre')) || 'Sin nombre',
      tipo_ct: tipoCt,
      es_inmueble_escolar: tipoCt !== TIPO_CONAFE,
      nivel,
      nivel_origen: nivelOrigen,
      servicion1: limpio(get('servicio_1'), 80),
      servicion2: limpio(get('servicio_2'), 80),
      servicion3: limpio(get('servicio_3'), 80),
      sostenimiento: normalizarSostenimiento(limpio(get('sostenimiento')) || descripcionAct),
      subcontrol: limpio(get('subcontrol'), 80),
      municipio: limpio(get('municipio'), 80),
      localidad: limpio(get('localidad'), 120),
      ambito: limpio(get('ambito'), 20).toLowerCase(),
      domicilio: armarDomicilio({ vialidad: get('vialidad'), num_ext: get('num_ext'), asentamiento: get('asentamiento'), cp: get('cp') }),
      lat: Math.round(lat * 1e6) / 1e6,
      lon: Math.round(lon * 1e6) / 1e6,
      alumnos: alumnos !== null && alumnos >= 0 ? Math.round(alumnos) : null,
      turnos,
      turnos_inactivos: turnosInactivos,
      fuente: limpio(get('fuente'), 80) || (esDenue ? 'DENUE (INEGI)' : 'Catálogo CCT (SEP)'),
      decimales_coord: decimales,
      ubicacion_aproximada: decimales === 'baja',
    });
    resumen.validas++;
  });
  return { escuelas, resumen, descartes, formato: columnas.formato, columnas };
}

// Une un renglón más de la misma escuela. Los turnos nuevos suman sus alumnos; si no trae ningún
// turno nuevo (mismo turno otra vez, o la misma escuela del DENUE) es un renglón repetido.
function unirTurno(base, otra) {
  const nuevos = otra.turnos.filter((t) => !base.turnos.includes(t));
  const inactivos = otra.turnos_inactivos.filter((t) => !base.turnos_inactivos.includes(t));
  base.turnos_inactivos.push(...inactivos);
  if (!nuevos.length) return false;
  base.turnos.push(...nuevos);
  if (otra.alumnos !== null) { base.alumnos = (base.alumnos ?? 0) + otra.alumnos; base._con++; } else base._sin++;
  return true;
}

// Lee todos los CSV de la carpeta (no entra a subcarpetas). Devuelve null si no hay ninguno.
// Un archivo con error no detiene a los demás: se reporta en `errores`.
export function cargarEscuelasDesdeCarpeta(carpeta) {
  if (!fs.existsSync(carpeta)) return null;
  const archivos = fs.readdirSync(carpeta).filter((a) => a.toLowerCase().endsWith('.csv')).sort();
  if (!archivos.length) return null;
  const porId = new Map();
  const resumen = {
    archivos: [], filas: 0, validas: 0, ...Object.fromEntries(MOTIVOS.map((m) => [m, 0])), cctNoCoincide: 0, tiposDescartados: {},
    turnosUnidos: 0, repetidas: 0, porFuente: {},
  };
  const descartes = [];
  const errores = [];
  for (const a of archivos) {
    let r;
    try { r = procesarEscuelas(leerTexto(path.join(carpeta, a)), a); } catch (e) { errores.push(e.message); continue; }
    resumen.archivos.push({ archivo: a, filas: r.resumen.filas, validas: r.resumen.validas, ...r.columnas });
    for (const k of ['filas', ...MOTIVOS, 'cctNoCoincide']) resumen[k] += r.resumen[k];
    for (const [t, n] of Object.entries(r.resumen.tiposDescartados)) resumen.tiposDescartados[t] = (resumen.tiposDescartados[t] || 0) + n;
    descartes.push(...r.descartes);
    for (const e of r.escuelas) {
      const base = porId.get(e.id);
      if (!base) { porId.set(e.id, { ...e, turnos: [...e.turnos], turnos_inactivos: [...e.turnos_inactivos], _con: e.alumnos === null ? 0 : 1, _sin: e.alumnos === null ? 1 : 0 }); continue; }
      if (unirTurno(base, e)) resumen.turnosUnidos++; else resumen.repetidas++;
    }
  }
  // alumnos_incompleto: algunos turnos traen matrícula y otros no (la suma es un mínimo).
  const escuelas = [...porId.values()].map(({ _con, _sin, ...e }) => (_con && _sin ? { ...e, alumnos_incompleto: true } : e));
  for (const e of escuelas) resumen.porFuente[e.fuente] = (resumen.porFuente[e.fuente] || 0) + 1;
  resumen.validas = escuelas.length;
  return { escuelas, resumen, descartes: descartes.slice(0, MAX_DESCARTES), errores };
}

// Huella barata de la carpeta (nombres, tamaños y fechas de los CSV) para recargar solo si cambió.
export function marcaCarpeta(carpeta) {
  try {
    return fs.readdirSync(carpeta).filter((a) => a.toLowerCase().endsWith('.csv')).sort()
      .map((a) => { const s = fs.statSync(path.join(carpeta, a)); return `${a}:${s.size}:${s.mtimeMs}`; }).join('|') || 'vacia';
  } catch { return 'sin-carpeta'; }
}
