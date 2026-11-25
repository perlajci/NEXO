// Revisa los CSV de data/escuelas/ sin arrancar el servidor: cuántas escuelas se leen, cuántas se
// descartan por cada motivo, qué columnas se reconocen, si traen latitud y longitud y qué valores
// distintos traen tipo de centro, nivel, turnos y sostenimiento.
//   npm run escuelas:revisar
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cargarEscuelasDesdeCarpeta, TIPOS_PLANTEL } from '../lib/escuelas.js';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const carpeta = path.join(process.env.NEXO_DATA || path.join(DIR, '..', 'data'), 'escuelas');
const n = (x) => Number(x || 0).toLocaleString('es-MX');
const r = cargarEscuelasDesdeCarpeta(carpeta);
if (!r) {
  console.log(`No hay archivos .csv en ${carpeta}`);
  process.exit(1);
}
const s = r.resumen;
const ENTIDAD = { clave: 'por clave de entidad', nombre: 'por nombre de entidad (el "21" de la CCT solo como revisión)', null: 'no viene: se usa el inicio de la CCT' };
for (const a of s.archivos) {
  console.log(`\n== ${a.archivo} (formato ${a.formato})`);
  console.log(`  Renglones: ${n(a.filas)} · válidos: ${n(a.validas)}`);
  console.log(`  Latitud y longitud: ${a.latLon ? `sí (${a.reconocidas.lat}, ${a.reconocidas.lon})` : 'NO'}`);
  console.log(`  Entidad: ${ENTIDAD[a.entidad]}${a.entidad ? ` (${a.reconocidas.entidad || a.reconocidas.entidad_nombre})` : ''}`);
  console.log(`  Alumnos: ${a.alumnos ? `sí (${a.reconocidas.alumnos})` : 'no viene (queda vacío)'} · Turno: ${a.turno ? 'sí' : 'no viene'}`);
  console.log('  Columnas reconocidas:', Object.entries(a.reconocidas).map(([c, h]) => (c === h ? h : `${h} → ${c}`)).join(', '));
  console.log('  Columnas NO reconocidas:', a.noReconocidas.length ? a.noReconocidas.join(', ') : '(ninguna)');
}
for (const e of r.errores) console.log(`\n!! ${e}`);
console.log(`
== Total
  Renglones leídos:                          ${n(s.filas)}
  Escuelas (una por CCT o id del DENUE):     ${n(s.validas)}
  Turnos en renglones aparte unidos a su CCT: ${n(s.turnosUnidos)}
  Renglones repetidos:                       ${n(s.repetidas)}
  Revisión: entidad Puebla con CCT que no empieza con 21 (no se descartan): ${n(s.cctNoCoincide)}
  Descartados:
    De otra entidad:                         ${n(s.otraEntidad)}
    No son planteles:                        ${n(s.noEscolares)}
    CCT inválida o vacía:                    ${n(s.cctInvalido)}
    Sin coordenadas:                         ${n(s.sinCoordenadas)}
    Coordenada en 0:                         ${n(s.coordCero)}
    Coordenada fuera de Puebla:              ${n(s.coordFueraDePuebla)}
  Por fuente: ${Object.entries(s.porFuente).map(([f, k]) => `${f}: ${n(k)}`).join(' · ')}`);

const tabla = (titulo, valores) => {
  const ord = Object.entries(valores).sort((a, b) => b[1] - a[1]);
  console.log(`\n${titulo} (${ord.length} valores)`);
  for (const [v, k] of ord) console.log(`  ${n(k).padStart(7)}  ${v || '(vacío)'}`);
};
const contar = (f) => { const m = {}; for (const e of r.escuelas) { const v = f(e); m[v] = (m[v] || 0) + 1; } return m; };

const tipos = { ...Object.fromEntries(Object.entries(s.tiposDescartados).map(([t, k]) => [`${t}  [descartado]`, k])) };
for (const [t, k] of Object.entries(contar((e) => e.tipo_ct))) if (t) tipos[`${t}  [plantel]`] = k;
if (Object.keys(tipos).length) tabla(`c_tipo en Puebla (planteles: ${TIPOS_PLANTEL.join(', ')})`, tipos);
tabla('tiponivelsub_c_servicion1 (tipo educativo) en los planteles', contar((e) => e.tipo_educativo));
tabla('tiponivelsub_c_servicion2 (nivel) en los planteles', contar((e) => e.nivel));
tabla('tiponivelsub_c_servicion3 (subnivel) en los planteles', contar((e) => e.subnivel));
tabla('Combinaciones c_tipo | servicion1 / servicion2', contar((e) => `${e.tipo_ct} | ${e.tipo_educativo || '(vacío)'} / ${e.nivel || '(vacío)'}`));
tabla('Turnos', contar((e) => e.turnos.join(' + ') || '(sin turno)'));
tabla('Sostenimiento / subcontrol', contar((e) => `${e.sostenimiento || '(vacío)'} / ${e.subcontrol || '(vacío)'}`));
tabla('Ámbito', contar((e) => e.ambito));
tabla('decimales_coord', contar((e) => e.decimales_coord));
const alumnos = r.escuelas.filter((e) => e.alumnos !== null);
console.log(`\nCon dato de alumnos: ${n(alumnos.length)} de ${n(r.escuelas.length)} escuelas`);
console.log(`Sin domicilio: ${n(r.escuelas.filter((e) => !e.domicilio).length)} · ejemplos:`);
for (const e of r.escuelas.slice(0, 3)) console.log(`  ${e.cct} ${e.nombre}: ${e.domicilio}`);

const coord = r.descartes.filter((d) => /coordenada/.test(d.motivo));
console.log(`\nDescartes por coordenada (${n(coord.length)}):${coord.length ? '' : ' ninguno'}`);
for (const d of coord) console.log(`  ${d.archivo} renglón ${d.fila} ${d.cct}: ${d.motivo}`);
const otros = r.descartes.filter((d) => !/coordenada|no es plantel/.test(d.motivo));
if (otros.length) {
  console.log('\nOtros descartes (primeros 15):');
  for (const d of otros.slice(0, 15)) console.log(`  ${d.archivo} renglón ${d.fila} ${d.cct}: ${d.motivo}`);
}
