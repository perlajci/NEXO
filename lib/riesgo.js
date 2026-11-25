// Índice de riesgo relativo de NEXO.
// Sigue el esquema del CENAPRED: Riesgo = Peligro × Exposición × Vulnerabilidad.
// - Peligro (0–1): depende del fenómeno y, para lluvias y heladas, del mes.
// - Vulnerabilidad (0–1): rango percentil dentro del estado de seis indicadores del Censo 2020.
// - Exposición: población de la localidad (se reporta aparte, no se mezcla en el índice).
// Es una ESTIMACIÓN para priorizar; no sustituye al Atlas Nacional de Riesgos.
import { distanciaKm } from './geo.js';

export const VOLCANES = [
  // Coordenadas aproximadas del cráter del Popocatépetl.
  { nombre: 'Popocatépetl', lat: 19.0225, lon: -98.6278, radioRestriccionKm: 12 },
];

export const FENOMENOS = {
  volcanico: { nombre: 'Volcánico (Popocatépetl)', estacional: false },
  sismico: { nombre: 'Sísmico', estacional: false },
  lluvias: { nombre: 'Lluvias intensas / inundación', estacional: true },
  heladas: { nombre: 'Heladas', estacional: true },
};

export const NIVELES = [
  { id: 'muy_alto', nombre: 'Muy alto', min: 0.6 },
  { id: 'alto', nombre: 'Alto', min: 0.4 },
  { id: 'medio', nombre: 'Medio', min: 0.2 },
  { id: 'bajo', nombre: 'Bajo', min: 0 },
];

export const nivelDe = (indice) => (indice === null ? null : NIVELES.find((n) => indice >= n.min).id);

// ---------- Vulnerabilidad ----------
const COMPONENTES_V = [
  { id: 'edad', etiqueta: '0–2 y 60+ años', f: (l) => ratio((l.P_0A2 ?? NaN) + (l.P_60YMAS ?? NaN), l.POBTOT) },
  { id: 'disc', etiqueta: 'Con discapacidad', f: (l) => ratio(l.PCON_DISC, l.POBTOT) },
  { id: 'salud', etiqueta: 'Sin servicios de salud', f: (l) => ratio(l.PSINDER, l.POBTOT) },
  { id: 'piso', etiqueta: 'Viviendas con piso de tierra', f: (l) => ratio(l.VPH_PISOTI, l.TVIVHAB) },
  { id: 'luz', etiqueta: 'Viviendas sin electricidad', f: (l) => ratio(l.VPH_S_ELEC, l.TVIVHAB) },
  { id: 'agua', etiqueta: 'Viviendas sin agua entubada', f: (l) => ratio(l.VPH_AGUAFV, l.TVIVHAB) },
];

function ratio(a, b) {
  if (a === null || a === undefined || b === null || b === undefined || !Number.isFinite(a) || !(b > 0)) return null;
  return Math.min(1, a / b);
}

// Rango percentil (0–1) con empates promediados.
function percentiles(valores) {
  const idx = valores.map((v, i) => [v, i]).filter(([v]) => v !== null).sort((a, b) => a[0] - b[0]);
  const out = new Array(valores.length).fill(null);
  const n = idx.length;
  if (n === 0) return out;
  let i = 0;
  while (i < n) {
    let j = i;
    while (j + 1 < n && idx[j + 1][0] === idx[i][0]) j++;
    const p = n === 1 ? 0.5 : ((i + j) / 2) / (n - 1);
    for (let k = i; k <= j; k++) out[idx[k][1]] = p;
    i = j + 1;
  }
  return out;
}

// Agrega l.V (0–1 o null) y l.Vn (número de componentes usados).
export function calcularVulnerabilidad(localidades) {
  const ranks = COMPONENTES_V.map((c) => percentiles(localidades.map(c.f)));
  localidades.forEach((l, i) => {
    const vals = ranks.map((r) => r[i]).filter((v) => v !== null);
    l.Vn = vals.length;
    l.V = vals.length >= 3 ? round(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
  });
  return COMPONENTES_V.map(({ id, etiqueta }) => ({ id, etiqueta }));
}

// ---------- Peligro por fenómeno ----------
export function peligroVolcanico(lat, lon) {
  let p = 0;
  for (const v of VOLCANES) {
    const d = distanciaKm(v.lat, v.lon, lat, lon);
    // Escalones relativos: dentro del radio de restricción, zona de caída de proyectiles/flujos,
    // zona de caída de ceniza frecuente y lejana. Ajustables con el mapa de peligros del CENAPRED.
    const pv = d <= v.radioRestriccionKm ? 1 : d <= 30 ? 0.7 : d <= 60 ? 0.4 : d <= 100 ? 0.15 : 0.05;
    p = Math.max(p, pv);
  }
  return p;
}

// Densidad sísmica: número de sismos (M ≥ magMin) a menos de radioKm, normalizado al máximo del estado.
// Suma de sismos a menos de radioKm de un punto, ponderada por energía relativa (suavizado).
export function sismicidadCruda(lat, lon, sismos, radioKm = 75) {
  let n = 0;
  for (const s of sismos) {
    if (Math.abs(s.lat - lat) > 1 || Math.abs(s.lon - lon) > 1.1) continue;
    const d = distanciaKm(lat, lon, s.lat, s.lon);
    if (d <= radioKm) n += 10 ** (0.5 * (s.mag - 4.5));
  }
  return n;
}

export function prepararSismico(localidades, sismos, radioKm = 75) {
  if (!sismos || !sismos.length) { localidades.forEach((l) => { l._sis = null; }); return null; }
  let max = 0;
  for (const l of localidades) {
    l._sisCrudo = sismicidadCruda(l.lat, l.lon, sismos, radioKm);
    if (l._sisCrudo > max) max = l._sisCrudo;
  }
  for (const l of localidades) l._sis = max > 0 ? round(Math.sqrt(l._sisCrudo / max)) : 0;
  return { radioKm, eventos: sismos.length, max };
}

// Peligro sísmico en cualquier punto (p. ej. una escuela), normalizado con el máximo de las
// localidades del estado (info = lo que devuelve prepararSismico), para que sea comparable.
export function peligroSismicoEnPunto(lat, lon, sismos, info) {
  if (!sismos || !sismos.length || !info) return null;
  if (!(info.max > 0)) return 0;
  return round(Math.sqrt(Math.min(1, sismicidadCruda(lat, lon, sismos, info.radioKm) / info.max)));
}

// Climatología en malla: [{lat, lon, meses:[{precip, heladas}]×12}]
export function asignarCelda(localidades, malla) {
  if (!malla || !malla.length) return;
  for (const l of localidades) {
    let mejor = null;
    let dm = Infinity;
    for (const c of malla) {
      const d = (c.lat - l.lat) ** 2 + (c.lon - l.lon) ** 2;
      if (d < dm) { dm = d; mejor = c; }
    }
    l._celda = mejor;
  }
}

export function peligroEstacional(l, fenomeno, mes, maximos) {
  const c = l._celda;
  if (!c || !maximos) return null;
  const m = c.meses[mes - 1];
  if (!m) return null;
  if (fenomeno === 'lluvias') return maximos.precip > 0 ? round(m.precip / maximos.precip) : 0;
  if (fenomeno === 'heladas') return maximos.heladas > 0 ? round(m.heladas / maximos.heladas) : 0;
  return null;
}

export function maximosMalla(malla) {
  if (!malla || !malla.length) return null;
  let precip = 0;
  let heladas = 0;
  for (const c of malla) for (const m of c.meses) { precip = Math.max(precip, m.precip); heladas = Math.max(heladas, m.heladas); }
  return { precip, heladas };
}

export function peligro(l, fenomeno, mes, maximos) {
  if (fenomeno === 'volcanico') return peligroVolcanico(l.lat, l.lon);
  if (fenomeno === 'sismico') return l._sis ?? null;
  return peligroEstacional(l, fenomeno, mes, maximos);
}

// Riesgo = Peligro × (0.5 + 0.5·V). Sin V se usa V = 0.5 y se marca.
export function indiceRiesgo(p, V) {
  if (p === null || p === undefined) return null;
  const v = V === null || V === undefined ? 0.5 : V;
  return round(p * (0.5 + 0.5 * v));
}

const round = (x) => Math.round(x * 1000) / 1000;
