// Reportes de daño en escuelas (paso 3). Se guardan en la misma capa que Operación
// (data/confirmaciones.json) con tipo "escuela".
//
// Registro: { id, tipo:'escuela', fecha (alta), fecha_dano, cct, escuela_id, inmueble_id, nombre,
//             lat, lon, dano, descripcion, origen, estado, historial:[{fecha, accion, ...}] }
// - dano: sin_dano | leve | moderado | grave | inhabitable
// - origen: manual (página) | espnow | lora | wifi (nodos ESP32, ver lib/trama.js)
// - estado: pendiente | verificado
//
// Reglas:
// - Un reporte en una CCT se aplica a todas las CCT de su mismo inmueble (inmueble_id), indicando
//   de qué CCT vino.
// - El daño de una escuela es el más grave entre los reportes VERIFICADOS. Si solo hay pendientes,
//   se toma el más grave de los pendientes y se marca "por verificar".
// - AFECTADA = daño leve o mayor (verificado o por verificar; el mapa dibuja distinto los segundos).
import { randomUUID } from 'node:crypto';

export const DANOS = ['sin_dano', 'leve', 'moderado', 'grave', 'inhabitable'];
export const NOMBRE_DANO = { sin_dano: 'Sin daño', leve: 'Leve', moderado: 'Moderado', grave: 'Grave', inhabitable: 'Inhabitable' };
export const ORIGENES = ['manual', 'espnow', 'lora', 'wifi'];
export const ESTADOS_REPORTE = ['pendiente', 'verificado'];
export const gravedad = (d) => DANOS.indexOf(d);
export const esAfectada = (d) => gravedad(d) >= gravedad('leve');
// Abreviaturas para la trama corta de los ESP32 (cct:gr).
export const DANO_ABREV = { sd: 'sin_dano', le: 'leve', mo: 'moderado', gr: 'grave', in: 'inhabitable' };

export class ErrorReporte extends Error {}

const texto = (v, n) => String(v ?? '').trim().replace(/\s+/g, ' ').slice(0, n);
// Texto corto para la lista de Operación (que muestra `nota`).
const conNota = (r) => ({ ...r, nota: `Daño ${NOMBRE_DANO[r.dano].toLowerCase()} (${r.estado}) · CCT ${r.cct || r.escuela_id}${r.descripcion ? ` · ${r.descripcion}` : ''}` });

// Normaliza "Inhabitable", "sin daño", "gr"… a la clave interna; null si no se reconoce.
export function normalizarDano(v) {
  const t = String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase().replace(/\s+/g, '_');
  if (DANO_ABREV[t]) return DANO_ABREV[t];
  return DANOS.includes(t) ? t : null;
}

/**
 * Valida un reporte nuevo para una escuela ya encontrada en el catálogo.
 * @param {object} b  cuerpo: {dano, descripcion, fecha, origen, estado}
 * @param {object} escuela  registro de lib/escuelas.js
 */
export function crearReporteEscuela(b, escuela, { ahora = new Date() } = {}) {
  const dano = normalizarDano(b?.dano);
  if (!dano) throw new ErrorReporte(`Daño inválido: usa ${DANOS.join(', ')}.`);
  const origen = ORIGENES.includes(b?.origen) ? b.origen : 'manual';
  const estado = ESTADOS_REPORTE.includes(b?.estado) ? b.estado : 'pendiente';
  let fechaDano = ahora.toISOString();
  if (b?.fecha) {
    const f = new Date(b.fecha);
    if (Number.isNaN(f.getTime())) throw new ErrorReporte('Fecha inválida.');
    if (f.getTime() > ahora.getTime() + 864e5) throw new ErrorReporte('La fecha del daño no puede ser futura.');
    fechaDano = f.toISOString();
  }
  const alta = ahora.toISOString();
  return conNota({
    id: randomUUID(),
    tipo: 'escuela',
    fecha: alta,
    fecha_dano: fechaDano,
    cct: escuela.cct,
    escuela_id: escuela.id,
    inmueble_id: escuela.inmueble_id || escuela.id,
    nombre: escuela.nombre,
    lat: escuela.lat,
    lon: escuela.lon,
    dano,
    descripcion: texto(b?.descripcion, 500),
    origen,
    estado,
    fuente: origen === 'manual' ? 'web' : 'lora', // compatibilidad con la lista de Operación
    personas: 0,
    necesidades: [],
    historial: [{ fecha: alta, accion: 'creado', dano, estado, origen }],
  });
}

// Cambia el estado (pendiente ↔ verificado) y deja constancia en el historial.
export function cambiarEstadoReporte(reporte, estado, { nota = '', ahora = new Date() } = {}) {
  if (!ESTADOS_REPORTE.includes(estado)) throw new ErrorReporte(`Estado inválido: usa ${ESTADOS_REPORTE.join(' o ')}.`);
  return conNota({
    ...reporte,
    estado,
    historial: [...(reporte.historial || []), { fecha: ahora.toISOString(), accion: estado === 'verificado' ? 'verificado' : 'regresado a pendiente', estado, nota: texto(nota, 240) }],
  });
}

// Reportes que aplican a una escuela: los de cualquier CCT de su inmueble.
export function reportesDeEscuela(escuela, reportes, inmuebleDe) {
  const inm = escuela.inmueble_id || escuela.id;
  return reportes
    .filter((r) => (inmuebleDe(r) ?? r.inmueble_id) === inm)
    .map((r) => ({ ...r, propio: r.escuela_id === escuela.id, deCct: r.cct || r.escuela_id }))
    .sort((a, b) => b.fecha_dano.localeCompare(a.fecha_dano));
}

// Estado de daño de un conjunto de reportes (ya filtrados por inmueble).
export function estadoDano(reportes) {
  if (!reportes.length) return null;
  const verificados = reportes.filter((r) => r.estado === 'verificado');
  const base = verificados.length ? verificados : reportes;
  const peor = base.reduce((m, r) => (gravedad(r.dano) > gravedad(m.dano) || (gravedad(r.dano) === gravedad(m.dano) && r.fecha_dano > m.fecha_dano) ? r : m));
  return {
    dano: peor.dano,
    verificado: verificados.length > 0,
    porVerificar: verificados.length === 0,
    afectada: esAfectada(peor.dano),
    deCct: peor.cct || peor.escuela_id,
    reporteId: peor.id,
    origen: peor.origen,
    fecha_dano: peor.fecha_dano,
    reportes: reportes.length,
    pendientes: reportes.length - verificados.length,
  };
}

/**
 * Daño por escuela para todo el catálogo: Map escuela.id → estadoDano. Solo incluye escuelas con
 * algún reporte (en ellas o en otra CCT del mismo inmueble).
 * @param {object[]} escuelas  catálogo (con inmueble_id)
 * @param {object[]} reportes  registros tipo "escuela"
 */
export function danoPorEscuela(escuelas, reportes) {
  const inmPorEscuela = new Map(escuelas.map((e) => [e.id, e.inmueble_id || e.id]));
  const porInmueble = new Map();
  for (const r of reportes) {
    // El inmueble se toma del catálogo actual; si la escuela ya no está, el guardado en el reporte.
    const inm = inmPorEscuela.get(r.escuela_id) ?? r.inmueble_id;
    if (!porInmueble.has(inm)) porInmueble.set(inm, []);
    porInmueble.get(inm).push(r);
  }
  const out = new Map();
  for (const e of escuelas) {
    const lista = porInmueble.get(inmPorEscuela.get(e.id));
    if (lista) out.set(e.id, { ...estadoDano(lista), propio: lista.some((r) => r.escuela_id === e.id) });
  }
  return out;
}
