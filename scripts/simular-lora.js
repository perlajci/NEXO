// SIMULADOR de un nodo ESP32 (no usa radio). Envía una trama a NEXO como lo haría la puerta de enlace.
// Formato: A|<nombre>|<personas>|<capacidad>|<lat>|<lon>|<necesidades>   (R = reporte, B = base)
// Uso: npm run lora:simular -- "A|Alb Sec 12|85|150|19.0412|-98.4123|ag,me"
const SERVIDOR = process.env.NEXO_URL || 'http://localhost:3000';
const trama = process.argv[2];
if (!trama) { console.log('Falta la trama. Ejemplo: A|Alb Sec 12|85|150|19.0412|-98.4123|ag,me'); process.exit(1); }
const r = await fetch(`${SERVIDOR}/api/lora/trama`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ trama, via: 'lora', rssi: -90 - Math.round(Math.random() * 25), puerta: 'simulador' }),
});
console.log(r.status, await r.text());
