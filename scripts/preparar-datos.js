// Descarga y guarda en caché los datos de APIs que tardan (correr una vez antes del evento):
//   npm run preparar
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { crearFuentes } from '../lib/fuentes.js';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const f = crearFuentes(path.join(process.env.NEXO_DATA || path.join(DIR, '..', 'data'), 'cache'));
const log = (m) => console.log(m);

log('1/2 Catálogo sísmico USGS (M≥4.5 desde 1980, región de Puebla)…');
const s = await f.catalogoSismos({ desde: '1980-01-01', magMin: 4.5 });
log(`    ${s.eventos.length} sismos guardados.`);
log(`2/2 Climatología Open-Meteo, ${f.malla().length} puntos de malla (tarda ~10 min, solo la primera vez)…`);
const c = await f.climatologia({ progreso: log });
log(`    ${c.celdas.length} celdas guardadas (${c.inicio} a ${c.fin}).`);
log('Listo. Ya puedes correr: npm start');
