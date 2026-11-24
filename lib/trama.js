// Formato de trama corta que envían los nodos ESP32 (por WiFi hoy, por LoRa después).
//   A|<nombre>|<personas>|<capacidad>|<lat>|<lon>|<necesidades separadas por coma>
//   R|...  = reporte de brigada · B|... = base de respuesta
// Necesidades abreviadas para ahorrar bytes: ag=agua al=alimentos me=medicinas am=atencion_medica
// co=cobijas tr=traslado en=energia cm=comunicacion (también acepta los nombres completos).
const ABREV = { ag: 'agua', al: 'alimentos', me: 'medicinas', am: 'atencion_medica', co: 'cobijas', tr: 'traslado', en: 'energia', cm: 'comunicacion' };

export function parsearTrama(texto) {
  const t = String(texto || '').trim();
  if (!t || t.length > 200) throw new Error('Trama vacía o demasiado larga');
  const [tipo, nombre, personas, capacidad, lat, lon, nec = ''] = t.split('|');
  if (!['A', 'R', 'B'].includes(tipo)) throw new Error('La trama debe empezar con A, R o B');
  return {
    tipo: tipo === 'R' ? 'reporte' : tipo === 'B' ? 'base' : 'albergue',
    nombre,
    personas: Number(personas),
    capacidad: capacidad === '' ? null : Number(capacidad),
    lat: Number(lat),
    lon: Number(lon),
    necesidades: nec.split(',').map((n) => ABREV[n.trim()] || n.trim()).filter(Boolean),
    bytes: Buffer.byteLength(t),
  };
}
