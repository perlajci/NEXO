// Utilidades geográficas sin dependencias.
const R = 6371.0088; // radio medio de la Tierra en km
const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;

export function distanciaKm(lat1, lon1, lat2, lon2) {
  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

// Punto destino a partir de un origen, rumbo (grados desde el norte) y distancia.
export function destino(lat, lon, rumboGrados, km) {
  const d = km / R;
  const b = rad(rumboGrados);
  const p1 = rad(lat);
  const l1 = rad(lon);
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b));
  const l2 = l1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
  return [deg(p2), ((deg(l2) + 540) % 360) - 180];
}

// Ray casting. puntos = [[lat, lon], ...]
export function dentroPoligono(lat, lon, puntos) {
  let dentro = false;
  for (let i = 0, j = puntos.length - 1; i < puntos.length; j = i++) {
    const [yi, xi] = puntos[i];
    const [yj, xj] = puntos[j];
    const cruza = yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (cruza) dentro = !dentro;
  }
  return dentro;
}

// geocerca = { tipo: 'circulo', centro: [lat, lon], radioKm } | { tipo: 'poligono', puntos: [[lat, lon], ...] }
export function validarGeocerca(g) {
  if (!g || typeof g !== 'object') throw new Error('Geocerca vacía');
  if (g.tipo === 'circulo') {
    const [lat, lon] = g.centro || [];
    const r = Number(g.radioKm);
    if (![lat, lon, r].every(Number.isFinite) || r <= 0 || r > 500) throw new Error('Círculo inválido');
    return { tipo: 'circulo', centro: [Number(lat), Number(lon)], radioKm: r };
  }
  if (g.tipo === 'poligono') {
    const pts = (g.puntos || []).map((p) => [Number(p[0]), Number(p[1])]).filter((p) => p.every(Number.isFinite));
    if (pts.length < 3 || pts.length > 2000) throw new Error('El polígono necesita al menos 3 vértices');
    return { tipo: 'poligono', puntos: pts };
  }
  throw new Error('Tipo de geocerca desconocido');
}

export function contiene(geocerca, lat, lon) {
  if (geocerca.tipo === 'circulo') return distanciaKm(geocerca.centro[0], geocerca.centro[1], lat, lon) <= geocerca.radioKm;
  return dentroPoligono(lat, lon, geocerca.puntos);
}

// Sector (cono) para dispersión aproximada de ceniza.
export function cono(lat, lon, rumbo, semiAngulo, largoKm, pasos = 12) {
  const pts = [[lat, lon]];
  for (let i = 0; i <= pasos; i++) {
    const b = rumbo - semiAngulo + (2 * semiAngulo * i) / pasos;
    pts.push(destino(lat, lon, b, largoKm));
  }
  return pts;
}

// Promedio circular de direcciones ponderado.
export function direccionMedia(direcciones, pesos) {
  let x = 0;
  let y = 0;
  direcciones.forEach((d, i) => {
    const w = pesos ? pesos[i] : 1;
    if (!Number.isFinite(d) || !Number.isFinite(w)) return;
    x += w * Math.cos(rad(d));
    y += w * Math.sin(rad(d));
  });
  if (x === 0 && y === 0) return null;
  return (deg(Math.atan2(y, x)) + 360) % 360;
}
