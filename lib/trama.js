// Formato de trama corta que envían los nodos ESP32 (por WiFi hoy, por LoRa después).
//   A|<nombre>|<personas>|<capacidad>|<lat>|<lon>|<necesidades separadas por coma>[|<nota>]
//   R|...  = reporte de brigada · B|... = base de respuesta
// Necesidades abreviadas para ahorrar bytes: ag=agua al=alimentos me=medicinas am=atencion_medica
// co=cobijas tr=traslado en=energia cm=comunicacion (también acepta los nombres completos).
//
// Campo opcional de escuela (posición 8, antes de la nota): <CCT> o <CCT>:<daño>
//   R|Brigada 3|12||19.0412|-98.4123|me|21DPR1273G:gr|Techo caído
// Daño abreviado: sd=sin daño le=leve mo=moderado gr=grave in=inhabitable (o el nombre completo).
// Si el campo 8 no tiene forma de CCT, se toma como nota, igual que antes: las tramas viejas no cambian.
const ABREV = { ag: 'agua', al: 'alimentos', me: 'medicinas', am: 'atencion_medica', co: 'cobijas', tr: 'traslado', en: 'energia', cm: 'comunicacion' };
const RE_CAMPO_CCT = /^\s*(\d{2}[A-Za-z]{3}\d{4}[A-Za-z])(?::([A-Za-z_ñÑ]+))?\s*$/;

export function parsearTrama(texto) {
  const t = String(texto || '').trim();
  if (!t || t.length > 240) throw new Error('Trama vacía o demasiado larga');
  const [tipo, nombre, personas, capacidad, lat, lon, nec = '', ...resto] = t.split('|');
  if (!['A', 'R', 'B'].includes(tipo)) throw new Error('La trama debe empezar con A, R o B');
  const m = resto.length ? resto[0].match(RE_CAMPO_CCT) : null;
  const nota = (m ? resto.slice(1) : resto).join(' ').trim();
  return {
    tipo: tipo === 'R' ? 'reporte' : tipo === 'B' ? 'base' : 'albergue',
    nombre,
    personas: Number(personas),
    capacidad: capacidad === '' ? null : Number(capacidad),
    lat: Number(lat),
    lon: Number(lon),
    necesidades: nec.split(',').map((n) => ABREV[n.trim()] || n.trim()).filter(Boolean),
    ...(m ? { cct: m[1].toUpperCase(), ...(m[2] ? { dano: m[2].toLowerCase() } : {}) } : {}),
    ...(nota ? { nota } : {}),
    bytes: Buffer.byteLength(t),
  };
}
