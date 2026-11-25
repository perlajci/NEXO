// Revisa los CSV de data/escuelas/ sin arrancar el servidor: cuántas escuelas se leen, cuántas se
// descartan por cada motivo, qué columnas se reconocen y si traen latitud y longitud.
//   npm run escuelas:revisar
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cargarEscuelasDesdeCarpeta } from '../lib/escuelas.js';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const carpeta = path.join(process.env.NEXO_DATA || path.join(DIR, '..', 'data'), 'escuelas');
const n = (x) => Number(x || 0).toLocaleString('es-MX');
const r = cargarEscuelasDesdeCarpeta(carpeta);
if (!r) {
  console.log(`No hay archivos .csv en ${carpeta}`);
  process.exit(1);
}
const s = r.resumen;
for (const a of s.archivos) {
  console.log(`\n== ${a.archivo} (formato ${a.formato})`);
  console.log(`  Renglones: ${n(a.filas)} · válidos: ${n(a.validas)}`);
  console.log(`  Latitud y longitud: ${a.latLon ? `sí (${a.reconocidas.lat}, ${a.reconocidas.lon})` : 'NO'}`);
  console.log(`  Clave de entidad: ${a.entidad ? `sí (${a.reconocidas.entidad})` : 'no viene: se usa el inicio de la CCT y el rectángulo'}`);
  console.log(`  Alumnos: ${a.alumnos ? `sí (${a.reconocidas.alumnos})` : 'no viene'} · Turno: ${a.turno ? `sí (${a.reconocidas.turno})` : 'no viene'}`);
  console.log('  Columnas reconocidas:', Object.entries(a.reconocidas).map(([c, h]) => `${h} → ${c}`).join(', '));
  console.log('  Columnas NO reconocidas:', a.noReconocidas.length ? a.noReconocidas.join(', ') : '(ninguna)');
}
for (const e of r.errores) console.log(`\n!! ${e}`);
console.log(`
== Total
  Renglones leídos:                         ${n(s.filas)}
  Escuelas (una por CCT o id del DENUE):    ${n(s.validas)}
  Turnos unidos a una CCT:                  ${n(s.turnosUnidos)}
  Renglones repetidos (mismo turno):        ${n(s.repetidas)}
  Descartadas:
    De otra entidad (clave ≠ 21):           ${n(s.otraEntidad)}
    Entidad 21 con coordenada fuera:        ${n(s.coordFueraDePuebla)}
    Sin coordenadas:                        ${n(s.sinCoordenadas)}
    CCT inválida o vacía:                   ${n(s.cctInvalido)}
    DENUE que no es escuela:                ${n(s.noEscolares)}
  Por fuente: ${Object.entries(s.porFuente).map(([f, k]) => `${f}: ${n(k)}`).join(' · ')}`);
const alumnos = r.escuelas.filter((e) => e.alumnos !== null);
console.log(`  Con dato de alumnos: ${n(alumnos.length)} escuelas (${n(alumnos.reduce((a, e) => a + e.alumnos, 0))} alumnos)`);
const dc = {};
for (const e of r.escuelas) dc[e.decimales_coord] = (dc[e.decimales_coord] || 0) + 1;
console.log(`  decimales_coord: alta ${n(dc.alta)} · media ${n(dc.media)} · baja ${n(dc.baja)}`);
if (r.descartes.length) {
  console.log('\nPrimeros descartes:');
  for (const d of r.descartes.slice(0, 15)) console.log(`  ${d.archivo} renglón ${d.fila}: ${d.motivo}`);
}
