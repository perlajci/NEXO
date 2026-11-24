// Propuesta de albergues estratégicos: modelo de cobertura máxima (MCLP) resuelto con
// un algoritmo voraz. Cada iteración elige la localidad candidata que cubre la mayor
// demanda todavía sin cubrir dentro del radio de servicio.
//
// - Demanda: localidades en riesgo (niveles elegidos) con peso = población × (0.5 + 0.5·V),
//   para dar prioridad a donde hay más bebés, adultos mayores, personas con discapacidad, etc.
// - Candidatas: localidades con población ≥ mínimo (con escuelas, centros de salud y vías;
//   el INEGI considera urbanas las de 2,500 habitantes o más) y peligro bajo para el
//   fenómeno elegido: el albergue debe estar fuera de la zona de peligro.
// Es una propuesta para discutir con Protección Civil, no una ubicación definitiva:
// falta verificar el inmueble (escuela, deportivo), su estado estructural y los accesos.
import { distanciaKm } from './geo.js';

export function sugerirAlbergues(localidades, opciones) {
  const {
    k = 8, radioKm = 25, pobMinCandidato = 2500, peligroMaxCandidato = 0.4,
    niveles = ['alto', 'muy_alto'], porcentajeAlbergue = 15, mun = null, riesgoDe,
  } = opciones;

  const demanda = [];
  const candidatas = [];
  for (const l of localidades) {
    const r = riesgoDe(l);
    if (r.nivel && niveles.includes(r.nivel) && (l.POBTOT || 0) > 0 && (!mun || l.mun === mun)) {
      const v = l.V ?? 0.5;
      demanda.push({ l, peso: l.POBTOT * (0.5 + 0.5 * v) });
    }
    if ((l.POBTOT || 0) >= pobMinCandidato && r.p !== null && r.p <= peligroMaxCandidato) candidatas.push({ l, p: r.p });
  }
  const pesoTotal = demanda.reduce((a, d) => a + d.peso, 0);
  const pobTotal = demanda.reduce((a, d) => a + d.l.POBTOT, 0);
  if (!demanda.length || !candidatas.length) {
    return { sitios: [], resumen: { demandaLocalidades: demanda.length, demandaPoblacion: pobTotal, candidatas: candidatas.length, cubierta: 0, porcentaje: 0 }, sinCubrir: [] };
  }

  // Lista de cobertura de cada candidata (con prefiltro por caja para ir rápido).
  const gLat = radioKm / 111;
  const cobertura = candidatas.map((c) => {
    const gLon = radioKm / (111 * Math.cos((c.l.lat * Math.PI) / 180));
    const lista = [];
    demanda.forEach((d, i) => {
      if (Math.abs(d.l.lat - c.l.lat) > gLat || Math.abs(d.l.lon - c.l.lon) > gLon) return;
      const dist = distanciaKm(c.l.lat, c.l.lon, d.l.lat, d.l.lon);
      if (dist <= radioKm) lista.push([i, dist]);
    });
    return lista;
  });

  const cubierta = new Array(demanda.length).fill(-1);
  const sitios = [];
  const usadas = new Set();
  for (let paso = 0; paso < k; paso++) {
    let mejor = -1;
    let mejorPeso = 0;
    cobertura.forEach((lista, ci) => {
      if (usadas.has(ci)) return;
      let w = 0;
      for (const [i] of lista) if (cubierta[i] < 0) w += demanda[i].peso;
      if (w > mejorPeso) { mejorPeso = w; mejor = ci; }
    });
    if (mejor < 0) break; // ya no hay demanda que cubrir
    usadas.add(mejor);
    const c = candidatas[mejor];
    const s = {
      orden: sitios.length + 1, id: c.l.id, nom: c.l.nom, nomMun: c.l.nomMun, mun: c.l.mun, lat: c.l.lat, lon: c.l.lon,
      poblacionLocal: c.l.POBTOT, peligroLocal: c.p,
      cubre: { localidades: 0, poblacion: 0, P_0A2: 0, P_60YMAS: 0, PCON_DISC: 0 }, distanciaMediaKm: 0, distanciaMaxKm: 0, atiende: [],
    };
    let sumaD = 0;
    for (const [i, dist] of cobertura[mejor]) {
      if (cubierta[i] >= 0) continue;
      cubierta[i] = sitios.length;
      const l = demanda[i].l;
      s.cubre.localidades++;
      s.cubre.poblacion += l.POBTOT || 0;
      for (const c2 of ['P_0A2', 'P_60YMAS', 'PCON_DISC']) s.cubre[c2] += l[c2] || 0;
      sumaD += dist * (l.POBTOT || 0);
      s.distanciaMaxKm = Math.max(s.distanciaMaxKm, dist);
      s.atiende.push({ nom: l.nom, nomMun: l.nomMun, poblacion: l.POBTOT, distanciaKm: r1(dist), lat: l.lat, lon: l.lon });
    }
    s.distanciaMediaKm = s.cubre.poblacion ? r1(sumaD / s.cubre.poblacion) : 0;
    s.distanciaMaxKm = r1(s.distanciaMaxKm);
    s.capacidadSugerida = Math.ceil((s.cubre.poblacion * porcentajeAlbergue) / 100);
    s.atiende.sort((a, b) => b.poblacion - a.poblacion);
    s.atiende = s.atiende.slice(0, 25);
    sitios.push(s);
  }

  const pobCubierta = sitios.reduce((a, s) => a + s.cubre.poblacion, 0);
  const sinCubrir = demanda
    .filter((_, i) => cubierta[i] < 0)
    .sort((a, b) => b.peso - a.peso)
    .slice(0, 20)
    .map((d) => ({ nom: d.l.nom, nomMun: d.l.nomMun, poblacion: d.l.POBTOT, lat: d.l.lat, lon: d.l.lon }));
  return {
    sitios,
    resumen: {
      demandaLocalidades: demanda.length, demandaPoblacion: pobTotal, candidatas: candidatas.length,
      cubierta: pobCubierta, porcentaje: pobTotal ? Math.round((1000 * pobCubierta) / pobTotal) / 10 : 0,
      capacidadTotal: sitios.reduce((a, s) => a + s.capacidadSugerida, 0),
    },
    sinCubrir,
    parametros: { k, radioKm, pobMinCandidato, peligroMaxCandidato, niveles, porcentajeAlbergue, mun },
  };
}

const r1 = (x) => Math.round(x * 10) / 10;
