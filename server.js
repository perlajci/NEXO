// NEXO · Servidor (Node 18+, sin dependencias externas).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { cargarITERDesdeCarpeta, agregar } from './lib/iter.js';
import { validarGeocerca, contiene, cono, direccionMedia, distanciaKm } from './lib/geo.js';
import {
  calcularVulnerabilidad, prepararSismico, asignarCelda, maximosMalla, peligro, indiceRiesgo,
  nivelDe, NIVELES, FENOMENOS, VOLCANES,
} from './lib/riesgo.js';
import { gutenbergRichter, histogramaMagnitudes, porAnio } from './lib/estadistica.js';
import { crearFuentes } from './lib/fuentes.js';
import { sugerirAlbergues } from './lib/albergues.js';
import { calcularRuta } from './lib/rutas.js';
import { parsearTrama } from './lib/trama.js';
import { leerTabulador, filtrarTabulador, resumenTabulador, CAPITULOS, TIPOS_DATO, UNIDADES } from './lib/tabulador.js';
import { calcularPresupuesto, cargarPlanteles, ErrorPresupuesto } from './lib/presupuesto.js';
import { armarGuardado, compararConTabulador, resumenGuardado, presupuestoACSV, nombreArchivoCSV, paraRecursosCapcee } from './lib/presupuestos.js';
import { crearAlmacenJSON } from './lib/almacen.js';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const DATA = process.env.NEXO_DATA || path.join(DIR, 'data');
const PUERTO = Number(process.env.PORT || 3000);
const fuentes = crearFuentes(path.join(DATA, 'cache'));
const ARCHIVO_CONF = path.join(DATA, 'confirmaciones.json');
const ARCHIVO_TAB = path.join(DATA, 'capcee', 'tabulador.csv');
const ARCHIVO_PLANTELES = path.join(DATA, 'capcee', 'planteles.csv'); // opcional; aún no existe
// Presupuestos guardados: misma capa que Operación (archivo JSON en data/). Para usar una base
// de datos, cambia solo esta línea por un objeto con guardar/listar/obtener/borrar (ver lib/almacen.js).
const presupuestos = crearAlmacenJSON(path.join(DATA, 'presupuestos.json'));
const AVISO_DISCO = 'Los presupuestos se guardan en un archivo del servidor. En el plan gratuito de Render el disco se borra al reiniciar: exporta a CSV los que necesites conservar.';

const estado = {
  iter: null, componentesV: [], sismos: null, sismoInfo: null, clima: null, maximos: null,
  errores: {}, trabajos: {},
};

// ---------- Carga de datos ----------
function cargarITER() {
  try {
    const r = cargarITERDesdeCarpeta(path.join(DATA, 'iter'));
    if (!r) { estado.iter = null; estado.errores.iter = 'No hay CSV del ITER en data/iter/'; return; }
    estado.componentesV = calcularVulnerabilidad(r.localidades);
    estado.iter = r;
    delete estado.errores.iter;
    if (estado.clima) asignarCelda(r.localidades, estado.clima.celdas);
    if (estado.sismos) estado.sismoInfo = prepararSismico(r.localidades, estado.sismos.eventos);
    console.log(`ITER: ${r.localidades.length} localidades con coordenadas (${r.resumen.archivos.join(', ')})`);
  } catch (e) { estado.errores.iter = e.message; console.error('ITER:', e.message); }
}

async function cargarSismos() {
  estado.trabajos.sismos = 'descargando';
  try {
    estado.sismos = await fuentes.catalogoSismos({ desde: '1980-01-01', magMin: 4.5 });
    if (estado.iter) estado.sismoInfo = prepararSismico(estado.iter.localidades, estado.sismos.eventos);
    delete estado.errores.sismos;
    estado.trabajos.sismos = 'listo';
  } catch (e) { estado.errores.sismos = `USGS: ${e.message}`; estado.trabajos.sismos = 'error'; }
}

async function cargarClima({ descargar = false } = {}) {
  if (!descargar && !fuentes.hayCache('clima_')) { estado.trabajos.clima = 'pendiente'; return; }
  estado.trabajos.clima = 'descargando';
  try {
    estado.clima = await fuentes.climatologia({ progreso: (m) => { estado.trabajos.climaProgreso = m.trim(); } });
    estado.maximos = maximosMalla(estado.clima.celdas);
    if (estado.iter) asignarCelda(estado.iter.localidades, estado.clima.celdas);
    delete estado.errores.clima;
    estado.trabajos.clima = 'listo';
  } catch (e) { estado.errores.clima = `Open-Meteo: ${e.message}`; estado.trabajos.clima = 'error'; }
}

// ---------- Confirmaciones (albergues / reportes; mañana también llegarán por LoRa) ----------
function leerConfirmaciones() {
  try { return JSON.parse(fs.readFileSync(ARCHIVO_CONF, 'utf8')); } catch { return []; }
}
function guardarConfirmaciones(lista) { fs.writeFileSync(ARCHIVO_CONF, JSON.stringify(lista, null, 1)); }
const NECESIDADES = ['agua', 'alimentos', 'medicinas', 'atencion_medica', 'cobijas', 'traslado', 'energia', 'comunicacion'];

function validarConfirmacion(b) {
  const lat = Number(b.lat);
  const lon = Number(b.lon);
  const personas = Math.round(Number(b.personas));
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) throw new Error('Ubicación inválida');
  if (!Number.isFinite(personas) || personas < 0 || personas > 100000) throw new Error('Número de personas inválido');
  const texto = (v, n) => String(v ?? '').slice(0, n).trim();
  return {
    id: randomUUID(),
    fecha: new Date().toISOString(),
    fuente: ['web', 'lora', 'brigada'].includes(b.fuente) ? b.fuente : 'web',
    tipo: ['reporte', 'base'].includes(b.tipo) ? b.tipo : 'albergue',
    nombre: texto(b.nombre, 80) || 'Sin nombre',
    lat, lon, personas,
    capacidad: Number.isFinite(Number(b.capacidad)) ? Math.max(0, Math.round(Number(b.capacidad))) : null,
    necesidades: Array.isArray(b.necesidades) ? b.necesidades.filter((n) => NECESIDADES.includes(n)) : [],
    nota: texto(b.nota, 240),
  };
}

// ---------- Tabulador CAPCEE ----------
// Se vuelve a leer solo si el archivo cambió (o apareció/desapareció), así un CSV nuevo se ve sin reiniciar.
let tabCache = { marca: null, datos: null };
function tabulador() {
  let marca = 'sin-archivo';
  try { const s = fs.statSync(ARCHIVO_TAB); marca = `${s.mtimeMs}-${s.size}`; } catch { /* no existe */ }
  if (tabCache.marca !== marca) tabCache = { marca, datos: leerTabulador(ARCHIVO_TAB) };
  return tabCache.datos;
}
// Si el tabulador no se pudo leer, responde 409 con un aviso para mostrar en la sección.
const requiereTabulador = (res) => {
  const t = tabulador();
  if (t.ok) return null;
  enviar(res, 409, { error: t.error, ayuda: t.ayuda });
  return true;
};

// ---------- Cálculos ----------
function riesgoDe(l, fenomeno, mes) {
  const p = peligro(l, fenomeno, mes, estado.maximos);
  const r = indiceRiesgo(p, l.V);
  return { p, r, nivel: nivelDe(r) };
}

function filtrar(localidades, { mun, niveles, pobMin }, fenomeno, mes) {
  return localidades.filter((l) => {
    if (mun && l.mun !== mun) return false;
    if (pobMin && (l.POBTOT || 0) < pobMin) return false;
    if (niveles && niveles.length) {
      const { nivel } = riesgoDe(l, fenomeno, mes);
      if (!niveles.includes(nivel)) return false;
    }
    return true;
  });
}

function resumenGeocerca(geocerca, fenomeno, mes, filtros) {
  const base = filtrar(estado.iter.localidades, filtros, fenomeno, mes);
  const dentro = base.filter((l) => contiene(geocerca, l.lat, l.lon));
  const ag = agregar(dentro);
  const porNivel = Object.fromEntries(NIVELES.map((n) => [n.id, { localidades: 0, poblacion: 0 }]).concat([['sin_dato', { localidades: 0, poblacion: 0 }]]));
  const filas = dentro.map((l) => {
    const r = riesgoDe(l, fenomeno, mes);
    const k = r.nivel || 'sin_dato';
    porNivel[k].localidades++;
    porNivel[k].poblacion += l.POBTOT || 0;
    return { id: l.id, nom: l.nom, nomMun: l.nomMun, POBTOT: l.POBTOT, P_0A2: l.P_0A2, P_60YMAS: l.P_60YMAS, PCON_DISC: l.PCON_DISC, V: l.V, ...r };
  });
  filas.sort((a, b) => (b.r ?? -1) - (a.r ?? -1) || (b.POBTOT || 0) - (a.POBTOT || 0));
  const municipios = {};
  for (const l of dentro) {
    const m = (municipios[l.mun] ||= { mun: l.mun, nombre: l.nomMun, poblacion: 0, localidades: 0 });
    m.poblacion += l.POBTOT || 0; m.localidades++;
  }
  const conf = leerConfirmaciones().filter((c) => c.tipo !== 'base' && contiene(geocerca, c.lat, c.lon));
  const confirmados = conf.reduce((a, c) => a + c.personas, 0);
  const necesidades = {};
  for (const c of conf) for (const n of c.necesidades) necesidades[n] = (necesidades[n] || 0) + 1;
  return {
    geocerca, fenomeno, mes,
    agregados: ag,
    porNivel,
    municipios: Object.values(municipios).sort((a, b) => b.poblacion - a.poblacion),
    localidades: filas.slice(0, 300),
    totalLocalidades: filas.length,
    operacion: {
      expuestos: ag.total.POBTOT,
      confirmados,
      sinConfirmar: Math.max(0, ag.total.POBTOT - confirmados),
      puntos: conf.length,
      necesidades,
    },
  };
}

const GRUPOS = ['P_0A2', 'P_60YMAS', 'PCON_DISC', 'P3YM_HLI', 'PSINDER'];

// Resumen de todos los municipios para el tablero.
function resumenMunicipios(fenomeno, mes) {
  const m = {};
  for (const l of estado.iter.localidades) {
    const x = (m[l.mun] ||= {
      mun: l.mun, nombre: l.nomMun, poblacion: 0, localidades: 0, _lat: 0, _lon: 0, _vp: 0, _vw: 0, _rp: 0, _rw: 0,
      riesgoMax: null, porNivel: { muy_alto: 0, alto: 0, medio: 0, bajo: 0, sin_dato: 0 }, ...Object.fromEntries(GRUPOS.map((g) => [g, 0])),
    });
    const pob = l.POBTOT || 0;
    x.poblacion += pob; x.localidades++;
    x._lat += l.lat * Math.max(pob, 1); x._lon += l.lon * Math.max(pob, 1); x._w = (x._w || 0) + Math.max(pob, 1);
    for (const g of GRUPOS) x[g] += l[g] || 0;
    if (l.V !== null && l.V !== undefined) { x._vp += l.V * pob; x._vw += pob; }
    const r = riesgoDe(l, fenomeno, mes);
    if (r.r !== null) { x._rp += r.r * pob; x._rw += pob; x.riesgoMax = Math.max(x.riesgoMax ?? 0, r.r); }
    x.porNivel[r.nivel || 'sin_dato'] += pob;
  }
  return Object.values(m).map((x) => {
    const { _lat, _lon, _w, _vp, _vw, _rp, _rw, ...resto } = x;
    const riesgo = _rw ? Math.round((1000 * _rp) / _rw) / 1000 : null;
    return {
      ...resto,
      lat: Math.round((_lat / _w) * 1e5) / 1e5, lon: Math.round((_lon / _w) * 1e5) / 1e5,
      vulnerabilidad: _vw ? Math.round((1000 * _vp) / _vw) / 1000 : null,
      riesgo, nivel: nivelDe(riesgo),
      pctRiesgoAlto: resto.poblacion ? Math.round((1000 * (resto.porNivel.alto + resto.porNivel.muy_alto)) / resto.poblacion) / 10 : 0,
    };
  });
}

function fichaMunicipio(mun, fenomeno, mes) {
  const lista = resumenMunicipios(fenomeno, mes);
  const meta = lista.find((x) => x.mun === mun);
  if (!meta) return null;
  const locs = estado.iter.localidades.filter((l) => l.mun === mun);
  const radio = Math.max(2, ...locs.map((l) => distanciaKm(meta.lat, meta.lon, l.lat, l.lon))) + 2;
  const g = { tipo: 'circulo', centro: [meta.lat, meta.lon], radioKm: Math.min(500, radio) };
  const r = resumenGeocerca(g, fenomeno, mes, { mun });
  const ordenados = lista.slice().sort((a, b) => (b.riesgo ?? -1) - (a.riesgo ?? -1));
  return {
    municipio: meta,
    lugarEstatal: { porRiesgo: ordenados.findIndex((x) => x.mun === mun) + 1, total: lista.length },
    area: { centro: [meta.lat, meta.lon], radioKm: g.radioKm },
    ...r,
    sismos: estado.sismos ? estadisticaSismica(meta.lat, meta.lon, 50, 4.5) : null,
    climatologia: estado.clima ? estado.clima.celdas.reduce((a, c) => ((c.lat - meta.lat) ** 2 + (c.lon - meta.lon) ** 2 < (a.lat - meta.lat) ** 2 + (a.lon - meta.lon) ** 2 ? c : a)) : null,
  };
}

function estadisticaSismica(lat, lon, radioKm, magMin) {
  const ev = (estado.sismos?.eventos || []).filter((s) => s.mag >= magMin && distanciaKm(lat, lon, s.lat, s.lon) <= radioKm);
  const anios = Math.max(1, (Date.now() - Date.parse(estado.sismos?.desde || '1980-01-01')) / (365.25 * 864e5));
  return {
    fuente: estado.sismos?.fuente, desde: estado.sismos?.desde, centro: [lat, lon], radioKm, magMin,
    total: ev.length,
    maxima: ev.reduce((m, s) => (s.mag > (m?.mag ?? -1) ? s : m), null),
    gutenbergRichter: gutenbergRichter(ev.map((s) => s.mag), magMin, anios),
    histograma: histogramaMagnitudes(ev.map((s) => s.mag), magMin),
    porAnio: porAnio(ev.map((s) => s.fecha)),
    recientes: ev.slice(-15).reverse(),
    eventos: ev.map((s) => [s.lat, s.lon, s.mag, s.fecha.slice(0, 10)]),
  };
}

// ---------- HTTP ----------
const TIPOS = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };

function enviar(res, codigo, cuerpo, tipo = 'application/json; charset=utf-8') {
  res.writeHead(codigo, { 'Content-Type': tipo, 'Cache-Control': 'no-store' });
  res.end(typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo));
}

async function leerCuerpo(req) {
  let s = '';
  for await (const c of req) { s += c; if (s.length > 1e6) throw new Error('Cuerpo demasiado grande'); }
  return s ? JSON.parse(s) : {};
}

const requiereITER = (res) => {
  if (estado.iter) return false;
  enviar(res, 409, { error: estado.errores.iter || 'ITER no cargado', ayuda: 'Copia el CSV del ITER de Puebla en data/iter/ y reinicia (ver README).' });
  return true;
};

const num = (v, d) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? d : Number(v));

async function api(req, res, url) {
  const ruta = url.pathname;
  const q = url.searchParams;
  const fenomeno = FENOMENOS[q.get('fenomeno')] ? q.get('fenomeno') : 'volcanico';
  const mes = Math.min(12, Math.max(1, Math.round(num(q.get('mes'), new Date().getMonth() + 1))));

  if (ruta === '/api/estado') {
    return enviar(res, 200, {
      iter: estado.iter ? { localidades: estado.iter.localidades.length, ...estado.iter.resumen } : null,
      sismos: estado.sismos ? { eventos: estado.sismos.eventos.length, desde: estado.sismos.desde, cache: estado.sismos._cache || null } : null,
      clima: estado.clima ? { celdas: estado.clima.celdas.length, inicio: estado.clima.inicio, fin: estado.clima.fin } : null,
      trabajos: estado.trabajos, errores: estado.errores,
      rutas: process.env.GOOGLE_MAPS_API_KEY ? 'google' : 'osrm',
      fenomenos: FENOMENOS, niveles: NIVELES, volcanes: VOLCANES, componentesV: estado.componentesV, necesidades: NECESIDADES,
    });
  }

  if (ruta === '/api/localidades') {
    if (requiereITER(res)) return;
    const datos = estado.iter.localidades.map((l) => {
      const r = riesgoDe(l, fenomeno, mes);
      return [l.id, l.nom, l.mun, l.nomMun, l.lat, l.lon, l.POBTOT, l.V, r.p, r.r, r.nivel];
    });
    return enviar(res, 200, { columnas: ['id', 'nom', 'mun', 'nomMun', 'lat', 'lon', 'POBTOT', 'V', 'P', 'R', 'nivel'], fenomeno, mes, datos });
  }

  if (ruta === '/api/municipios') {
    if (requiereITER(res)) return;
    const m = {};
    for (const l of estado.iter.localidades) {
      const x = (m[l.mun] ||= { mun: l.mun, nombre: l.nomMun, poblacion: 0, localidades: 0 });
      x.poblacion += l.POBTOT || 0; x.localidades++;
    }
    return enviar(res, 200, Object.values(m).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')));
  }

  if (ruta === '/api/geocerca' && req.method === 'POST') {
    if (requiereITER(res)) return;
    const b = await leerCuerpo(req);
    const g = validarGeocerca(b.geocerca);
    const f = FENOMENOS[b.fenomeno] ? b.fenomeno : fenomeno;
    const m = Math.min(12, Math.max(1, Math.round(num(b.mes, mes))));
    const filtros = {
      mun: typeof b.filtros?.mun === 'string' && b.filtros.mun ? b.filtros.mun : null,
      niveles: Array.isArray(b.filtros?.niveles) ? b.filtros.niveles.filter((n) => NIVELES.some((x) => x.id === n)) : [],
      pobMin: Math.max(0, num(b.filtros?.pobMin, 0)),
    };
    return enviar(res, 200, resumenGeocerca(g, f, m, filtros));
  }

  if (ruta === '/api/sismos') {
    if (!estado.sismos) return enviar(res, 503, { error: estado.errores.sismos || 'Catálogo sísmico aún descargando' });
    const lat = num(q.get('lat'), 19.04);
    const lon = num(q.get('lon'), -98.2);
    return enviar(res, 200, estadisticaSismica(lat, lon, Math.min(300, num(q.get('radioKm'), 100)), Math.max(2, num(q.get('magMin'), 4.5))));
  }

  if (ruta === '/api/clima') {
    const lat = num(q.get('lat'), 19.04);
    const lon = num(q.get('lon'), -98.2);
    let pron = null;
    let errorPron = null;
    try { pron = await fuentes.pronostico(lat, lon); } catch (e) { errorPron = `sin conexión con Open-Meteo (${e.message})`; }
    let celda = null;
    if (estado.clima) {
      celda = estado.clima.celdas.reduce((m, c) => ((c.lat - lat) ** 2 + (c.lon - lon) ** 2 < (m.lat - lat) ** 2 + (m.lon - lon) ** 2 ? c : m));
    }
    return enviar(res, 200, { pronostico: pron, errorPronostico: errorPron, climatologia: celda, periodo: estado.clima ? `${estado.clima.inicio} a ${estado.clima.fin}` : null });
  }

  if (ruta === '/api/ceniza') {
    if (requiereITER(res)) return;
    const v = VOLCANES[0];
    const semi = Math.min(60, Math.max(5, num(q.get('semi'), 20)));
    const largo = Math.min(250, Math.max(10, num(q.get('largo'), 100)));
    const horas = Math.min(48, Math.max(3, num(q.get('horas'), 24)));
    let w;
    try { w = await fuentes.vientoAltura(v.lat, v.lon); } catch (e) { return enviar(res, 503, { error: `No se pudo obtener el viento: ${e.message}` }); }
    const ahora = Date.now();
    const h = w.horario || {};
    const idx = (h.time || []).map((t, i) => [Date.parse(t), i]).filter(([t]) => t >= ahora - 36e5 && t <= ahora + horas * 36e5).map(([, i]) => i);
    const dirs = idx.map((i) => h.wind_direction_500hPa[i]);
    const vel = idx.map((i) => h.wind_speed_500hPa[i]);
    const desde = direccionMedia(dirs, vel);
    if (desde === null) return enviar(res, 503, { error: 'Sin datos de viento para el periodo' });
    const hacia = (desde + 180) % 360; // el viento meteorológico indica de dónde sopla
    const poligono = cono(v.lat, v.lon, hacia, semi, largo);
    const r = resumenGeocerca({ tipo: 'poligono', puntos: poligono }, 'volcanico', mes, {});
    return enviar(res, 200, {
      volcan: v, vientoDesde: Math.round(desde), haciaGrados: Math.round(hacia),
      velocidadMediaKmh: Math.round(vel.reduce((a, b) => a + (b || 0), 0) / (vel.length || 1)), horas, semi, largo, poligono,
      fuente: w.fuente, resumen: { agregados: r.agregados, municipios: r.municipios.slice(0, 15), totalLocalidades: r.totalLocalidades },
    });
  }

  if (ruta === '/api/municipios/resumen') {
    if (requiereITER(res)) return;
    const lista = resumenMunicipios(fenomeno, mes);
    const estatal = { poblacion: 0, localidades: 0, porNivel: { muy_alto: 0, alto: 0, medio: 0, bajo: 0, sin_dato: 0 }, ...Object.fromEntries(GRUPOS.map((g) => [g, 0])) };
    for (const x of lista) {
      estatal.poblacion += x.poblacion; estatal.localidades += x.localidades;
      for (const g of GRUPOS) estatal[g] += x[g];
      for (const n of Object.keys(estatal.porNivel)) estatal.porNivel[n] += x.porNivel[n];
    }
    return enviar(res, 200, { fenomeno, mes, estatal, municipios: lista });
  }

  if (ruta.startsWith('/api/municipio/')) {
    if (requiereITER(res)) return;
    const mun = decodeURIComponent(ruta.split('/').pop()).padStart(3, '0');
    const f = fichaMunicipio(mun, fenomeno, mes);
    return f ? enviar(res, 200, f) : enviar(res, 404, { error: 'Municipio no encontrado' });
  }

  if (ruta === '/api/albergues/sugerir' && req.method === 'POST') {
    if (requiereITER(res)) return;
    const b = await leerCuerpo(req);
    const f = FENOMENOS[b.fenomeno] ? b.fenomeno : fenomeno;
    const m = Math.min(12, Math.max(1, Math.round(num(b.mes, mes))));
    const niveles = Array.isArray(b.niveles) && b.niveles.length ? b.niveles.filter((n) => NIVELES.some((x) => x.id === n)) : ['alto', 'muy_alto'];
    const r = sugerirAlbergues(estado.iter.localidades, {
      k: Math.min(40, Math.max(1, Math.round(num(b.k, 8)))),
      radioKm: Math.min(100, Math.max(2, num(b.radioKm, 25))),
      pobMinCandidato: Math.max(0, num(b.pobMinCandidato, 2500)),
      peligroMaxCandidato: Math.min(1, Math.max(0, num(b.peligroMaxCandidato, 0.4))),
      porcentajeAlbergue: Math.min(100, Math.max(1, num(b.porcentajeAlbergue, 15))),
      niveles,
      mun: typeof b.mun === 'string' && b.mun ? b.mun : null,
      riesgoDe: (l) => riesgoDe(l, f, m),
    });
    return enviar(res, 200, { fenomeno: f, mes: m, ...r });
  }

  if (ruta === '/api/ruta') {
    const par = (v) => String(v || '').split(',').map(Number);
    const o = par(q.get('origen'));
    const d = par(q.get('destino'));
    if (o.length !== 2 || d.length !== 2 || ![...o, ...d].every(Number.isFinite)) return enviar(res, 400, { error: 'Usa origen=lat,lon y destino=lat,lon' });
    return enviar(res, 200, { origen: o, destino: d, ...(await calcularRuta(o, d)) });
  }

  if (ruta === '/api/cercano') {
    const lat = num(q.get('lat'), NaN);
    const lon = num(q.get('lon'), NaN);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return enviar(res, 400, { error: 'Faltan lat y lon' });
    const tipo = ['albergue', 'base', 'reporte'].includes(q.get('tipo')) ? q.get('tipo') : 'albergue';
    const lista = leerConfirmaciones().filter((c) => c.tipo === tipo)
      .map((c) => ({ ...c, distanciaKm: Math.round(distanciaKm(lat, lon, c.lat, c.lon) * 10) / 10 }))
      .sort((a, b) => a.distanciaKm - b.distanciaKm).slice(0, 5);
    return enviar(res, 200, lista);
  }

  // Lista pública mínima para la página sin internet (sin notas internas).
  if (ruta === '/api/albergues/publicos') {
    const lista = leerConfirmaciones().filter((c) => c.tipo === 'albergue')
      .map((c) => ({ nombre: c.nombre, lat: c.lat, lon: c.lon, personas: c.personas, capacidad: c.capacidad, fecha: c.fecha }));
    return enviar(res, 200, { actualizado: new Date().toISOString(), albergues: lista });
  }

  // Trama de un nodo ESP32 (WiFi hoy, LoRa mañana). Acepta texto plano o {trama, rssi, puerta}.
  if (ruta === '/api/lora/trama' && req.method === 'POST') {
    let cuerpo = '';
    for await (const c of req) { cuerpo += c; if (cuerpo.length > 4000) throw new Error('Trama demasiado grande'); }
    let trama = cuerpo;
    let extra = {};
    try { const j = JSON.parse(cuerpo); if (j && typeof j === 'object') { trama = j.trama; extra = j; } } catch { /* texto plano */ }
    const p = parsearTrama(trama);
    const via = ['wifi', 'lora', 'espnow'].includes(extra.via) ? extra.via : 'lora';
    const meta = `Nodo ESP32 por ${via.toUpperCase()} (${p.bytes} bytes${Number.isFinite(Number(extra.rssi)) ? `, RSSI ${Number(extra.rssi)} dBm` : ''}${extra.puerta ? `, puerta ${String(extra.puerta).slice(0, 30)}` : ''})`;
    const c = validarConfirmacion({
      ...p, fuente: 'lora',
      nota: p.nota ? `${p.nota} · ${meta}` : meta,
    });
    const lista = leerConfirmaciones();
    // Un albergue o base actualiza su estado por nombre; los reportes de emergencia se agregan como entradas nuevas.
    const i = c.tipo === 'reporte' ? -1 : lista.findIndex((x) => x.fuente === 'lora' && x.nombre === c.nombre && x.tipo === c.tipo);
    if (i >= 0) lista[i] = { ...c, id: lista[i].id }; else lista.push(c);
    guardarConfirmaciones(lista);
    return enviar(res, i >= 0 ? 200 : 201, i >= 0 ? lista[i] : c);
  }

  if (ruta === '/api/confirmaciones' && req.method === 'GET') return enviar(res, 200, leerConfirmaciones());
  if (ruta === '/api/confirmaciones' && req.method === 'POST') {
    const c = validarConfirmacion(await leerCuerpo(req));
    const lista = leerConfirmaciones();
    lista.push(c);
    guardarConfirmaciones(lista);
    return enviar(res, 201, c);
  }
  if (ruta.startsWith('/api/confirmaciones/') && req.method === 'DELETE') {
    const id = ruta.split('/').pop();
    const lista = leerConfirmaciones();
    const nueva = lista.filter((c) => c.id !== id);
    guardarConfirmaciones(nueva);
    return enviar(res, nueva.length < lista.length ? 200 : 404, { ok: nueva.length < lista.length });
  }

  // Catálogo filtrado: ?buscar=&capitulo=&tipo=
  if (ruta === '/api/tabulador' && req.method === 'GET') {
    if (requiereTabulador(res)) return;
    const t = tabulador();
    const filtros = { buscar: (q.get('buscar') || '').slice(0, 100), capitulo: q.get('capitulo') || '', tipo: q.get('tipo') || '' };
    const conceptos = filtrarTabulador(t.conceptos, filtros);
    return enviar(res, 200, {
      filtros, total: conceptos.length, totalCatalogo: t.conceptos.length, conceptos,
      rechazados: t.rechazados, actualizado: t.actualizado,
      catalogos: { capitulos: CAPITULOS, tipos: TIPOS_DATO, unidades: UNIDADES },
    });
  }
  if (ruta === '/api/tabulador/resumen' && req.method === 'GET') {
    if (requiereTabulador(res)) return;
    const t = tabulador();
    return enviar(res, 200, { ...resumenTabulador(t.conceptos), rechazados: t.rechazados.length, actualizado: t.actualizado });
  }
  // Calcula un presupuesto: {obra, cct, factor, renglones:[{clave_ref, cantidad}]}. No guarda nada.
  if (ruta === '/api/presupuesto/calcular' && req.method === 'POST') {
    if (requiereTabulador(res)) return;
    const b = await leerCuerpo(req);
    try {
      return enviar(res, 200, calcularPresupuesto(b, tabulador().conceptos, cargarPlanteles(ARCHIVO_PLANTELES)));
    } catch (e) {
      if (e instanceof ErrorPresupuesto) return enviar(res, 400, { error: e.message, errores: e.errores });
      throw e;
    }
  }

  // ---------- Presupuestos guardados ----------
  if (ruta === '/api/presupuestos' && req.method === 'GET') {
    const t = tabulador();
    const catalogo = t.ok ? t.conceptos : null;
    let lista = presupuestos.listar();
    if (q.get('recursos') === '1') lista = lista.filter((p) => p.recursosCapcee);
    lista.sort((a, b) => b.fecha.localeCompare(a.fecha));
    return enviar(res, 200, { almacen: presupuestos.tipo, aviso: AVISO_DISCO, huellaActual: t.ok ? t.huella : null, presupuestos: lista.map((p) => resumenGuardado(p, catalogo)) });
  }
  if (ruta === '/api/presupuestos' && req.method === 'POST') {
    if (requiereTabulador(res)) return;
    const t = tabulador();
    const b = await leerCuerpo(req);
    // Solo se usan obra, cct, factor y {clave_ref, cantidad}: precios, importes y totales que
    // mande el navegador se ignoran y se vuelven a calcular aquí.
    const entrada = {
      obra: b.obra, cct: b.cct, factor: b.factor,
      renglones: Array.isArray(b.renglones) ? b.renglones.map((r) => ({ clave_ref: r?.clave_ref, cantidad: r?.cantidad })) : [],
    };
    let calculo;
    try { calculo = calcularPresupuesto(entrada, t.conceptos, cargarPlanteles(ARCHIVO_PLANTELES)); } catch (e) {
      if (e instanceof ErrorPresupuesto) return enviar(res, 400, { error: e.message, errores: e.errores });
      throw e;
    }
    return enviar(res, 201, presupuestos.guardar(armarGuardado(calculo, t)));
  }
  const mp = ruta.match(/^\/api\/presupuestos\/([\w-]{1,64})(\/csv|\/recursos)?$/);
  if (mp) {
    const [, id, extra] = mp;
    const p = presupuestos.obtener(id);
    if (!p) return enviar(res, 404, { error: 'Presupuesto no encontrado' });
    if (!extra && req.method === 'GET') {
      const t = tabulador();
      return enviar(res, 200, { ...p, comparacion: t.ok ? compararConTabulador(p, t.conceptos) : null, huellaActual: t.ok ? t.huella : null });
    }
    if (!extra && req.method === 'DELETE') return enviar(res, 200, { ok: presupuestos.borrar(id) });
    if (extra === '/csv' && req.method === 'GET') {
      res.writeHead(200, {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${nombreArchivoCSV(p)}"`,
        'Cache-Control': 'no-store',
      });
      return res.end(presupuestoACSV(p));
    }
    // Deja el presupuesto disponible para el futuro módulo Recursos CAPCEE (ver paraRecursosCapcee).
    if (extra === '/recursos' && req.method === 'POST') {
      const marcado = presupuestos.guardar({ ...p, recursosCapcee: p.recursosCapcee || new Date().toISOString() });
      return enviar(res, 200, paraRecursosCapcee(marcado));
    }
    return enviar(res, 405, { error: 'Método no permitido' });
  }

  if (ruta === '/api/preparar/clima' && req.method === 'POST') {
    if (estado.trabajos.clima !== 'descargando') cargarClima({ descargar: true });
    return enviar(res, 202, { trabajo: 'clima', estado: 'descargando' });
  }
  if (ruta === '/api/recargar' && req.method === 'POST') { cargarITER(); return enviar(res, 200, { ok: !!estado.iter }); }

  return enviar(res, 404, { error: 'Ruta no encontrada' });
}

function estatico(res, ruta) {
  const pub = path.join(DIR, 'public');
  const f = path.normalize(path.join(pub, ruta === '/' ? 'index.html' : decodeURIComponent(ruta)));
  if (!f.startsWith(pub)) return enviar(res, 403, 'Prohibido', 'text/plain');
  fs.readFile(f, (err, buf) => {
    if (err) return enviar(res, 404, 'No encontrado', 'text/plain');
    res.writeHead(200, { 'Content-Type': TIPOS[path.extname(f)] || 'application/octet-stream' });
    res.end(buf);
  });
}

export const servidor = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname.startsWith('/api/')) await api(req, res, url);
    else estatico(res, url.pathname);
  } catch (e) {
    enviar(res, 400, { error: e.message });
  }
});

export async function iniciar() {
  cargarITER();
  await cargarClima();
  cargarSismos(); // en segundo plano
  await new Promise((r) => servidor.listen(PUERTO, r));
  console.log(`NEXO listo en http://localhost:${PUERTO}`);
  return servidor;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) iniciar();
