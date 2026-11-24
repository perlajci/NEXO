// Rutas de atención. Proveedores, en este orden:
// 1. Google Routes API (si existe la variable GOOGLE_MAPS_API_KEY). Considera tráfico.
// 2. OSRM con datos de OpenStreetMap (servidor de demostración, sin llave; solo para prototipo).
// 3. Sin conexión: línea recta con tiempo estimado a velocidad promedio (aviso visible).
// Ninguno conoce los cierres de vías causados por el desastre: hay que confirmar en campo.
import { distanciaKm } from './geo.js';

// Decodifica una polilínea codificada de Google en [[lat, lon], ...].
export function decodificarPolilinea(str) {
  const puntos = [];
  let i = 0;
  let lat = 0;
  let lon = 0;
  while (i < str.length) {
    for (const eje of [0, 1]) {
      let resultado = 0;
      let corrimiento = 0;
      let b;
      do {
        b = str.charCodeAt(i++) - 63;
        resultado |= (b & 0x1f) << corrimiento;
        corrimiento += 5;
      } while (b >= 0x20);
      const delta = resultado & 1 ? ~(resultado >> 1) : resultado >> 1;
      if (eje === 0) lat += delta; else lon += delta;
    }
    puntos.push([lat / 1e5, lon / 1e5]);
  }
  return puntos;
}

async function conTiempo(url, opciones = {}, ms = 15000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try { return await fetch(url, { ...opciones, signal: ctl.signal }); } finally { clearTimeout(t); }
}

async function rutaGoogle(o, d, llave) {
  const r = await conTiempo('https://routes.googleapis.com/directions/v2:computeRoutes', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': llave,
      'X-Goog-FieldMask': 'routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline',
    },
    body: JSON.stringify({
      origin: { location: { latLng: { latitude: o[0], longitude: o[1] } } },
      destination: { location: { latLng: { latitude: d[0], longitude: d[1] } } },
      travelMode: 'DRIVE',
      routingPreference: 'TRAFFIC_AWARE',
      languageCode: 'es-MX',
    }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error?.message || `Google Routes HTTP ${r.status}`);
  const ruta = j.routes?.[0];
  if (!ruta) throw new Error('Google no encontró ruta');
  return {
    proveedor: 'Google Maps (Routes API, con tráfico)',
    distanciaKm: Math.round(ruta.distanceMeters / 100) / 10,
    duracionMin: Math.round(parseInt(ruta.duration, 10) / 60),
    geometria: decodificarPolilinea(ruta.polyline.encodedPolyline),
  };
}

async function rutaOSRM(o, d) {
  const base = process.env.OSRM_URL || 'https://router.project-osrm.org';
  const url = `${base}/route/v1/driving/${o[1]},${o[0]};${d[1]},${d[0]}?overview=full&geometries=geojson`;
  const r = await conTiempo(url, { headers: { 'User-Agent': 'NEXO-HackaTec2026/0.2 (prototipo escolar)' } });
  const j = await r.json();
  if (!r.ok || j.code !== 'Ok' || !j.routes?.length) throw new Error(j.message || `OSRM HTTP ${r.status}`);
  const ruta = j.routes[0];
  return {
    proveedor: 'OpenStreetMap + OSRM (servidor de demostración, sin tráfico)',
    distanciaKm: Math.round(ruta.distance / 100) / 10,
    duracionMin: Math.round(ruta.duration / 60),
    geometria: ruta.geometry.coordinates.map(([lon, lat]) => [lat, lon]),
  };
}

export async function calcularRuta(origen, destino) {
  const avisos = [];
  const llave = process.env.GOOGLE_MAPS_API_KEY;
  if (llave) {
    try { return { ...(await rutaGoogle(origen, destino, llave)), avisos }; } catch (e) { avisos.push(`Google: ${e.message}`); }
  }
  try { return { ...(await rutaOSRM(origen, destino)), avisos }; } catch (e) { avisos.push(`OSRM: ${e.message}`); }
  // Sin conexión: línea recta, con factor de rodeo típico de carreteras (1.3) y 40 km/h.
  const recta = distanciaKm(origen[0], origen[1], destino[0], destino[1]);
  return {
    proveedor: 'Sin conexión: estimación en línea recta',
    distanciaKm: Math.round(recta * 1.3 * 10) / 10,
    duracionMin: Math.round(((recta * 1.3) / 40) * 60),
    geometria: [origen, destino],
    estimada: true,
    avisos,
  };
}
