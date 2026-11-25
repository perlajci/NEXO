// Riesgo por escuela con el mismo modelo que las localidades (lib/riesgo.js):
//   Riesgo = Peligro (en el punto de la escuela) × (0.5 + 0.5 · V)
// - Peligro: volcánico por distancia al cráter desde la escuela; sísmico con los sismos alrededor
//   de la escuela, normalizado con el máximo de las localidades del estado; lluvias y heladas con
//   la celda de la malla climática más cercana a la escuela.
// - V (vulnerabilidad): la de la localidad del censo INEGI más cercana. Se guarda la distancia a
//   esa localidad: si es grande, la vulnerabilidad es menos representativa.
//
// Definiciones que usa toda la interfaz:
// - EN PELIGRO: nivel de riesgo "alto" o "muy alto" con el fenómeno y el mes elegidos. Es una
//   estimación del modelo.
// - AFECTADA: escuela con al menos un reporte de daño leve o mayor (dato de campo, paso 3).
import { distanciaKm } from './geo.js';
import { peligro, indiceRiesgo, nivelDe, asignarCelda, peligroSismicoEnPunto, FENOMENOS } from './riesgo.js';

export const NIVELES_EN_PELIGRO = ['alto', 'muy_alto'];
export const enPeligro = (nivel) => NIVELES_EN_PELIGRO.includes(nivel);

const quitarAcentos = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

// Índice en rejilla para buscar la localidad más cercana sin recorrer las 6 mil cada vez.
export function crearIndiceLocalidades(localidades, celda = 0.1) {
  const rejilla = new Map();
  const k = (i, j) => `${i},${j}`;
  for (const l of localidades) {
    const key = k(Math.floor(l.lat / celda), Math.floor(l.lon / celda));
    if (!rejilla.has(key)) rejilla.set(key, []);
    rejilla.get(key).push(l);
  }
  return {
    // Busca en anillos de celdas; al encontrar candidatas revisa dos anillos más (la celda en
    // longitud mide menos km que en latitud) para no quedarse con una que no es la más cercana.
    cercana(lat, lon, maxAnillos = 40) {
      const ci = Math.floor(lat / celda);
      const cj = Math.floor(lon / celda);
      let mejor = null;
      let dMejor = Infinity;
      let extra = -1;
      for (let r = 0; r <= maxAnillos; r++) {
        for (let i = ci - r; i <= ci + r; i++) {
          for (let j = cj - r; j <= cj + r; j++) {
            if (Math.max(Math.abs(i - ci), Math.abs(j - cj)) !== r) continue; // solo el borde del anillo
            for (const l of rejilla.get(k(i, j)) || []) {
              const d = distanciaKm(lat, lon, l.lat, l.lon);
              if (d < dMejor) { dMejor = d; mejor = l; }
            }
          }
        }
        if (mejor && extra < 0) extra = 2;
        if (extra >= 0 && extra-- === 0) break;
      }
      return mejor ? { localidad: mejor, distanciaKm: dMejor } : null;
    },
  };
}

/**
 * Prepara lo que no depende del fenómeno ni del mes: localidad más cercana, municipio, peligro
 * sísmico en el punto y celda climática. Devuelve un "punto" por escuela.
 * @param {object[]} escuelas  registros de lib/escuelas.js
 * @param {object[]} localidades  del ITER, con V calculada
 * @param {{sismos?:object[], sismoInfo?:object, malla?:object[]}} contexto
 */
export function prepararEscuelas(escuelas, localidades, { sismos = null, sismoInfo = null, malla = null } = {}) {
  const indice = crearIndiceLocalidades(localidades);
  // Clave de municipio por nombre (el CSV de la SEP trae el nombre; el censo, nombre y clave).
  const munPorNombre = new Map();
  for (const l of localidades) if (!munPorNombre.has(quitarAcentos(l.nomMun))) munPorNombre.set(quitarAcentos(l.nomMun), l.mun);
  const puntos = escuelas.map((e) => {
    const c = indice.cercana(e.lat, e.lon);
    const loc = c?.localidad || null;
    return {
      e,
      lat: e.lat,
      lon: e.lon,
      loc,
      distLocKm: c ? Math.round(c.distanciaKm * 100) / 100 : null,
      V: loc?.V ?? null,
      // Municipio por el nombre que trae la escuela; si no coincide con el censo, el de la localidad más cercana.
      mun: munPorNombre.get(quitarAcentos(e.municipio)) || loc?.mun || '',
      munPorNombre: munPorNombre.has(quitarAcentos(e.municipio)),
      _sis: peligroSismicoEnPunto(e.lat, e.lon, sismos, sismoInfo),
    };
  });
  if (malla?.length) asignarCelda(puntos, malla);
  return puntos;
}

// Riesgo de un punto de escuela con un fenómeno y un mes.
export function riesgoEscuela(punto, fenomeno, mes, maximos) {
  const p = peligro(punto, fenomeno, mes, maximos);
  const r = indiceRiesgo(p, punto.V);
  return { p, V: punto.V, r, nivel: nivelDe(r) };
}

// Riesgo con los cuatro fenómenos (para la ficha).
export function riesgoPorFenomeno(punto, mes, maximos) {
  return Object.fromEntries(Object.keys(FENOMENOS).map((f) => [f, riesgoEscuela(punto, f, mes, maximos)]));
}

// Filtros de /api/escuelas. `estado`: 'peligro' | 'afectada' | 'todas' | 'peligro_afectada'.
export function filtrarEscuelas(filas, { nivel = '', mun = '', estado = 'todas', buscar = '', riesgo = [] } = {}) {
  const palabras = quitarAcentos(buscar).split(/\s+/).filter(Boolean);
  const munNorm = quitarAcentos(mun);
  return filas.filter((f) => {
    if (nivel && f.e.nivel !== nivel) return false;
    if (mun && f.mun !== mun.padStart(3, '0') && quitarAcentos(f.e.municipio) !== munNorm) return false;
    if (estado === 'peligro' && !f.enPeligro) return false;
    if (estado === 'afectada' && !f.afectada) return false;
    if (estado === 'peligro_afectada' && !f.enPeligro && !f.afectada) return false;
    if (riesgo.length && !riesgo.includes(f.riesgo.nivel || 'sin_dato')) return false;
    if (palabras.length) {
      const texto = quitarAcentos(`${f.e.cct} ${f.e.nombre} ${f.e.localidad} ${f.e.municipio}`);
      if (!palabras.every((p) => texto.includes(p))) return false;
    }
    return true;
  });
}

// Resumen para la tarjeta de Inicio y el tablero: total, en peligro, afectadas, alumnos expuestos
// (solo si hay dato) y desglose por municipio, nivel educativo y nivel de riesgo.
export function resumenEscuelas(filas) {
  const conAlumnos = filas.filter((f) => f.e.alumnos !== null);
  const nuevo = () => ({ total: 0, enPeligro: 0, afectadas: 0, muy_alto: 0, alto: 0, alumnosExpuestos: 0 });
  const sumar = (x, f) => {
    x.total++;
    if (f.enPeligro) { x.enPeligro++; x.alumnosExpuestos += f.e.alumnos || 0; }
    if (f.afectada) x.afectadas++;
    if (f.riesgo.nivel === 'muy_alto') x.muy_alto++;
    if (f.riesgo.nivel === 'alto') x.alto++;
  };
  const total = nuevo();
  const porMun = new Map();
  const porNivel = new Map();
  const porRiesgo = { muy_alto: 0, alto: 0, medio: 0, bajo: 0, sin_dato: 0 };
  for (const f of filas) {
    sumar(total, f);
    porRiesgo[f.riesgo.nivel || 'sin_dato']++;
    const m = porMun.get(f.mun) || { mun: f.mun, municipio: f.loc && f.munPorNombre ? f.e.municipio : f.loc?.nomMun || f.e.municipio, ...nuevo() };
    sumar(m, f);
    porMun.set(f.mun, m);
    const nv = f.e.nivel || '(sin nivel)';
    const n = porNivel.get(nv) || { nivel: nv, ...nuevo() };
    sumar(n, f);
    porNivel.set(nv, n);
  }
  const hayAlumnos = conAlumnos.length > 0;
  const limpiar = (x) => (hayAlumnos ? x : { ...x, alumnosExpuestos: null });
  const orden = (a, b) => b.enPeligro - a.enPeligro || b.afectadas - a.afectadas || b.total - a.total;
  return {
    total: total.total,
    enPeligro: total.enPeligro,
    afectadas: total.afectadas,
    enPeligroInmuebleEscolar: filas.filter((f) => f.enPeligro && f.e.es_inmueble_escolar).length,
    porRiesgo,
    alumnosExpuestos: hayAlumnos ? total.alumnosExpuestos : null,
    escuelasConAlumnos: conAlumnos.length,
    avisoAlumnos: hayAlumnos
      ? (conAlumnos.length < filas.length ? `Solo ${conAlumnos.length} de ${filas.length} escuelas traen alumnos: la cifra es un mínimo.` : null)
      : 'El catálogo de escuelas no trae número de alumnos, así que no se pueden contar alumnos expuestos.',
    porMunicipio: [...porMun.values()].map(limpiar).sort(orden),
    porNivel: [...porNivel.values()].map(limpiar).sort(orden),
  };
}
