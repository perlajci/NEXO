// Escuelas en el Tabulador y en las exportaciones (paso 6).
// - priorizarInmuebles: lista "Escuelas prioritarias", por inmueble con sus CCT dentro.
// - contextoEscuela: foto de la escuela (ubicación, riesgo y daño) que se guarda con un presupuesto.
// - reportesACSV: reportes de daño en escuelas para Excel.
import { NOMBRE_DANO } from './reportes-escuelas.js';
import { FENOMENOS, NIVELES } from './riesgo.js';
import { fila, fechaLocal, BOM } from './presupuestos.js';

// Grupos de prioridad, en este orden. Dentro de cada grupo: más alumnos primero; si el inmueble
// no tiene dato de alumnos, más población a 2 km primero.
export const GRUPOS = [
  { id: 1, clave: 'afectada_grave', nombre: 'Afectadas: daño grave o inhabitable' },
  { id: 2, clave: 'afectada_leve', nombre: 'Afectadas: daño leve o moderado' },
  { id: 3, clave: 'peligro_muy_alto', nombre: 'En peligro: riesgo muy alto' },
  { id: 4, clave: 'peligro_alto', nombre: 'En peligro: riesgo alto' },
];
const GRAVES = ['grave', 'inhabitable'];
const ORDEN_NIVEL = ['bajo', 'medio', 'alto', 'muy_alto'];
const nombreNivel = (id) => NIVELES.find((n) => n.id === id)?.nombre || 'Sin dato';

// Grupo de un inmueble (o null si no entra en la lista).
export function grupoDe({ afectada, dano, nivel }) {
  if (afectada) return GRAVES.includes(dano) ? 1 : 2;
  if (nivel === 'muy_alto') return 3;
  if (nivel === 'alto') return 4;
  return null;
}

/**
 * @param {object[]} filas  filas de riesgo por escuela (las de filasEscuelas en server.js)
 * @param {object[]} presupuestos  guardados (se usa `cct` e `id`)
 * @param {{conafe?:boolean}} opciones  conafe: incluir inmuebles que solo tienen centros CONAFE
 */
export function priorizarInmuebles(filas, presupuestos = [], { conafe = false } = {}) {
  const presPorCct = new Map();
  for (const p of presupuestos) {
    if (!p.cct) continue;
    if (!presPorCct.has(p.cct)) presPorCct.set(p.cct, []);
    presPorCct.get(p.cct).push({ id: p.id, obra: p.obra, fecha: p.fecha, total: p.total });
  }
  const porInm = new Map();
  for (const f of filas) {
    const k = f.e.inmueble_id || f.e.id;
    if (!porInm.has(k)) porInm.set(k, []);
    porInm.get(k).push(f);
  }
  const lista = [];
  let sinInmuebleEscolar = 0;
  for (const [inmueble, fs] of porInm) {
    // Todas las CCT del inmueble comparten daño (el reporte se aplica al inmueble). Riesgo: el más alto.
    const conDano = fs.find((f) => f.afectada) || null;
    const nivel = fs.map((f) => f.riesgo.nivel).filter(Boolean).sort((a, b) => ORDEN_NIVEL.indexOf(b) - ORDEN_NIVEL.indexOf(a))[0] || null;
    const grupo = grupoDe({ afectada: !!conDano, dano: conDano?.dano?.dano, nivel });
    if (!grupo) continue;
    if (!conafe && fs.every((f) => f.e.es_inmueble_escolar === false)) { sinInmuebleEscolar++; continue; }
    const conAlumnos = fs.filter((f) => f.e.alumnos !== null && f.e.alumnos !== undefined);
    const alumnos = conAlumnos.length ? conAlumnos.reduce((a, f) => a + f.e.alumnos, 0) : null;
    const presupuestosInm = fs.flatMap((f) => presPorCct.get(f.e.cct) || []);
    const base = fs[0];
    lista.push({
      inmueble_id: inmueble,
      grupo,
      grupoNombre: GRUPOS[grupo - 1].nombre,
      escuelas: fs.map((f) => ({ id: f.e.id, cct: f.e.cct, nombre: f.e.nombre, nivel: f.e.nivel, alumnos: f.e.alumnos, es_inmueble_escolar: f.e.es_inmueble_escolar })),
      municipio: base.e.municipio,
      localidad: base.e.localidad,
      domicilio: base.e.domicilio,
      lat: base.e.lat,
      lon: base.e.lon,
      nivelRiesgo: nivel,
      dano: conDano ? { dano: conDano.dano.dano, verificado: conDano.dano.verificado, deCct: conDano.dano.deCct } : null,
      alumnos,
      alumnosIncompleto: conAlumnos.length > 0 && conAlumnos.length < fs.length,
      pob2km: base.pob2km ?? null,
      ordenadoPor: alumnos !== null ? 'alumnos' : 'pob2km',
      tienePresupuesto: presupuestosInm.length > 0,
      presupuestos: presupuestosInm,
    });
  }
  const clave = (x) => (x.alumnos !== null ? x.alumnos : x.pob2km ?? 0);
  lista.sort((a, b) => a.grupo - b.grupo
    || (b.alumnos !== null) - (a.alumnos !== null) // con dato de alumnos antes que sin dato
    || clave(b) - clave(a)
    || a.inmueble_id.localeCompare(b.inmueble_id));
  const porGrupo = Object.fromEntries(GRUPOS.map((g) => [g.id, lista.filter((x) => x.grupo === g.id).length]));
  return { grupos: GRUPOS, porGrupo, total: lista.length, sinInmuebleEscolar, conPresupuesto: lista.filter((x) => x.tienePresupuesto).length, inmuebles: lista };
}

// Foto de la escuela para guardar con un presupuesto (el riesgo y el daño cambian con el tiempo:
// así el CSV dice con qué datos se armó). `f` es una fila de riesgo de la escuela.
export function contextoEscuela(f, fenomeno, mes) {
  return {
    cct: f.e.cct,
    id: f.e.id,
    nombre: f.e.nombre,
    nivel: f.e.nivel,
    municipio: f.e.municipio,
    localidad: f.e.localidad,
    inmueble_id: f.e.inmueble_id,
    lat: f.e.lat,
    lon: f.e.lon,
    fuente_coord: f.e.fuente_coord || f.e.fuente,
    decimales_coord: f.e.decimales_coord,
    fenomeno,
    fenomenoNombre: FENOMENOS[fenomeno]?.nombre || fenomeno,
    mes: FENOMENOS[fenomeno]?.estacional ? mes : null,
    riesgo: { nivel: f.riesgo.nivel, indice: f.riesgo.r, peligro: f.riesgo.p, vulnerabilidad: f.riesgo.V },
    enPeligro: f.enPeligro,
    dano: f.dano ? { dano: f.dano.dano, verificado: f.dano.verificado, origen: f.dano.origen, deCct: f.dano.deCct, fecha_dano: f.dano.fecha_dano } : null,
  };
}

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
export const textoEscenario = (fenomeno, mes) => `${FENOMENOS[fenomeno]?.nombre || fenomeno}${FENOMENOS[fenomeno]?.estacional && mes ? `, ${MESES[mes - 1]}` : ''}`;
export const textoDano = (d) => (d ? `${NOMBRE_DANO[d.dano]} (${d.verificado ? 'verificado' : 'por verificar'})` : 'Sin reportes de daño');

// Renglones de la escuela para el encabezado del CSV de un presupuesto.
export function filasEscuelaCSV(esc) {
  if (!esc) return [fila('Escuela', 'Sin datos de la escuela: la CCT no está en el catálogo o el presupuesto es anterior')];
  return [
    fila('Escuela', esc.nombre),
    fila('Latitud', esc.lat),
    fila('Longitud', esc.lon),
    fila('Fuente de la coordenada', esc.fuente_coord),
    fila('Nivel de riesgo', `${nombreNivel(esc.riesgo.nivel)}${esc.riesgo.indice !== null && esc.riesgo.indice !== undefined ? ` (índice ${esc.riesgo.indice})` : ''}`),
    fila('Fenómeno y mes usados', textoEscenario(esc.fenomeno, esc.mes)),
    fila('Estado de daño', textoDano(esc.dano)),
    fila('Origen del reporte de daño', esc.dano ? `${esc.dano.origen}${esc.dano.deCct && esc.dano.deCct !== esc.cct ? ` (reportado en ${esc.dano.deCct}, mismo inmueble)` : ''}` : ''),
  ];
}

/**
 * CSV de reportes de daño en escuelas (un renglón por reporte).
 * @param {{reporte:object, fila:object|null}[]} items  el reporte y la fila de riesgo actual de su escuela
 */
export function reportesACSV(items, { fenomeno, mes }) {
  const L = [
    fila('Reportes de daño en escuelas (PIANI)'),
    fila('Fenómeno y mes usados para el riesgo', textoEscenario(fenomeno, mes)),
    fila('Exportado', fechaLocal(new Date().toISOString())),
    '',
    fila('Fecha del daño', 'Fecha de alta', 'CCT', 'Escuela', 'Municipio', 'Localidad', 'Latitud', 'Longitud', 'Fuente de la coordenada',
      'Daño reportado', 'Estado del reporte', 'Origen del reporte', 'Estado de daño de la escuela', 'Nivel de riesgo', 'Fenómeno y mes usados',
      'Inmueble', 'Descripción', 'Id del reporte'),
  ];
  for (const { reporte: r, fila: f } of items) {
    L.push(fila(
      fechaLocal(r.fecha_dano), fechaLocal(r.fecha), r.cct || r.escuela_id, r.nombre, f?.e.municipio ?? '', f?.e.localidad ?? '',
      f?.e.lat ?? r.lat, f?.e.lon ?? r.lon, f ? (f.e.fuente_coord || f.e.fuente) : 'catálogo (la escuela ya no está)',
      NOMBRE_DANO[r.dano], r.estado, r.origen, f ? textoDano(f.dano) : '', f ? nombreNivel(f.riesgo.nivel) : '', textoEscenario(fenomeno, mes),
      r.inmueble_id, r.descripcion, r.id,
    ));
  }
  return BOM + L.join('\r\n') + '\r\n';
}
