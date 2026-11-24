// Conexión con APIs públicas (sin llave): USGS (sismos) y Open-Meteo (clima).
// Todo se guarda en data/cache para no repetir descargas y para seguir funcionando sin red.
import fs from 'node:fs';
import path from 'node:path';
import { climatologiaMensual } from './estadistica.js';

export const BBOX_PUEBLA = { minLat: 17.8, maxLat: 20.9, minLon: -99.1, maxLon: -96.7 };

export function crearFuentes(carpetaCache) {
  fs.mkdirSync(carpetaCache, { recursive: true });
  const archivo = (nombre) => path.join(carpetaCache, `${nombre}.json`);

  function leerCache(nombre, maxHoras) {
    try {
      const f = archivo(nombre);
      const edadH = (Date.now() - fs.statSync(f).mtimeMs) / 36e5;
      if (maxHoras !== undefined && edadH > maxHoras) return null;
      return { datos: JSON.parse(fs.readFileSync(f, 'utf8')), edadHoras: edadH };
    } catch { return null; }
  }
  const escribirCache = (nombre, datos) => fs.writeFileSync(archivo(nombre), JSON.stringify(datos));

  async function obtenerJSON(url, timeoutMs = 30000) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const r = await fetch(url, { signal: ctl.signal, headers: { 'User-Agent': 'NEXO-HackaTec2026/1.0' } });
      if (!r.ok) throw new Error(`HTTP ${r.status} en ${new URL(url).host}`);
      return await r.json();
    } finally { clearTimeout(t); }
  }

  // Usa la caché si está fresca; si la API falla, devuelve la caché vieja marcada.
  async function conCache(nombre, maxHoras, cargar) {
    const fresca = leerCache(nombre, maxHoras);
    if (fresca) return { ...fresca.datos, _cache: { horas: Math.round(fresca.edadHoras * 10) / 10 } };
    try {
      const datos = await cargar();
      datos._descargado = new Date().toISOString();
      escribirCache(nombre, datos);
      return datos;
    } catch (e) {
      const vieja = leerCache(nombre);
      if (vieja) return { ...vieja.datos, _cache: { horas: Math.round(vieja.edadHoras), vencida: true }, _error: e.message };
      throw e;
    }
  }

  // Catálogo USGS (FDSN) en la región de Puebla con margen de ~1°.
  async function catalogoSismos({ desde = '1980-01-01', magMin = 4.5 } = {}) {
    const nombre = `usgs_${desde}_${magMin}`;
    return conCache(nombre, 24, async () => {
      const q = new URLSearchParams({
        format: 'geojson', starttime: desde, minmagnitude: String(magMin), orderby: 'time-asc', limit: '20000',
        minlatitude: String(BBOX_PUEBLA.minLat - 1), maxlatitude: String(BBOX_PUEBLA.maxLat + 1),
        minlongitude: String(BBOX_PUEBLA.minLon - 1.2), maxlongitude: String(BBOX_PUEBLA.maxLon + 1.2),
      });
      const j = await obtenerJSON(`https://earthquake.usgs.gov/fdsnws/event/1/query?${q}`, 60000);
      const eventos = (j.features || [])
        .filter((f) => f.properties && Number.isFinite(f.properties.mag) && f.geometry)
        .map((f) => ({
          id: f.id, mag: f.properties.mag, lugar: f.properties.place, fecha: new Date(f.properties.time).toISOString(),
          lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1], prof: f.geometry.coordinates[2],
        }));
      return { fuente: 'USGS FDSN Event Web Service (ComCat)', desde, magMin, eventos };
    });
  }

  // Malla de 0.5° sobre Puebla; climatología 2015–2024 (ERA5 vía Open-Meteo Historical Weather API).
  function malla(paso = 0.5) {
    const pts = [];
    for (let lat = Math.floor(BBOX_PUEBLA.minLat * 2) / 2 + 0.25; lat <= BBOX_PUEBLA.maxLat; lat += paso)
      for (let lon = Math.floor(BBOX_PUEBLA.minLon * 2) / 2 + 0.25; lon <= BBOX_PUEBLA.maxLon; lon += paso)
        pts.push({ lat: Math.round(lat * 100) / 100, lon: Math.round(lon * 100) / 100 });
    return pts;
  }

  // Open-Meteo cuenta cada 2 semanas de datos por punto como una llamada y limita ~600 por minuto,
  // así que se descarga un punto a la vez con pausa. Tarda varios minutos UNA sola vez
  // (npm run preparar) y queda en caché un año.
  const esperar = (ms) => new Promise((res) => setTimeout(res, ms));
  async function climatologia({ inicio = process.env.CLIMA_INICIO || '2020-01-01', fin = process.env.CLIMA_FIN || '2024-12-31', progreso } = {}) {
    return conCache(`clima_${inicio}_${fin}`, 24 * 365, async () => {
      const puntos = malla();
      const celdas = [];
      for (const [i, p] of puntos.entries()) {
        const q = new URLSearchParams({
          latitude: String(p.lat), longitude: String(p.lon), start_date: inicio, end_date: fin,
          daily: 'precipitation_sum,temperature_2m_min', timezone: 'America/Mexico_City',
        });
        let j;
        for (let intento = 1; ; intento++) {
          try { j = await obtenerJSON(`https://archive-api.open-meteo.com/v1/archive?${q}`, 120000); break; }
          catch (e) {
            if (intento >= 4) throw e;
            if (progreso) progreso(`  reintento ${intento} (${e.message}); espero 65 s…`);
            await esperar(65000);
          }
        }
        const d = j.daily || {};
        celdas.push({ lat: p.lat, lon: p.lon, meses: climatologiaMensual(d.time || [], d.precipitation_sum || [], d.temperature_2m_min || []) });
        if (progreso) progreso(`  clima ${i + 1}/${puntos.length} (${p.lat}, ${p.lon})`);
        await esperar(Number(process.env.CLIMA_PAUSA_MS || 12000));
      }
      return { fuente: 'Open-Meteo Historical Weather API (reanálisis ERA5)', inicio, fin, celdas };
    });
  }

  const hayCache = (prefijo) => {
    try { return fs.readdirSync(carpetaCache).some((a) => a.startsWith(prefijo)); } catch { return false; }
  };

  // Pronóstico de 7 días para un punto.
  async function pronostico(lat, lon) {
    const k = `pron_${lat.toFixed(2)}_${lon.toFixed(2)}`;
    return conCache(k, 3, async () => {
      const q = new URLSearchParams({
        latitude: String(lat), longitude: String(lon), timezone: 'America/Mexico_City', forecast_days: '7',
        daily: 'precipitation_sum,precipitation_probability_max,temperature_2m_min,temperature_2m_max,wind_speed_10m_max',
      });
      const j = await obtenerJSON(`https://api.open-meteo.com/v1/forecast?${q}`);
      return { fuente: 'Open-Meteo Forecast API', lat, lon, diario: j.daily };
    });
  }

  // Viento en 500 hPa (~5.5 km) sobre el volcán: altura típica de las columnas de ceniza.
  async function vientoAltura(lat, lon) {
    return conCache(`viento_${lat.toFixed(2)}_${lon.toFixed(2)}`, 3, async () => {
      const q = new URLSearchParams({
        latitude: String(lat), longitude: String(lon), timezone: 'America/Mexico_City', forecast_days: '2',
        hourly: 'wind_direction_500hPa,wind_speed_500hPa',
      });
      const j = await obtenerJSON(`https://api.open-meteo.com/v1/forecast?${q}`);
      return { fuente: 'Open-Meteo Forecast API (500 hPa)', horario: j.hourly };
    });
  }

  return { catalogoSismos, climatologia, pronostico, vientoAltura, malla, hayCache };
}
