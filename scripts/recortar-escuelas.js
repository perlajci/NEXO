// Recorta el Catálogo Nacional de Centros de Trabajo (CNCT) de la SEP a solo Puebla.
//   npm run escuelas:recortar                      (lee data/escuelas/cnct2026.csv)
//   npm run escuelas:recortar -- ruta/al/cnct.csv
// - Guarda data/escuelas/escuelas_puebla.csv con las mismas columnas (UTF-8 con BOM) y solo los
//   renglones con inmueble_c_nom_ent = Puebla. No quita ningún tipo de centro: los filtros de
//   planteles, CCT y coordenadas los aplica el lector, que así puede contar cada descarte.
// - Mueve el archivo nacional a data/escuelas/original/ para que el servidor no lo lea dos veces
//   (el lector solo toma los CSV de data/escuelas/, no los de subcarpetas). Esa carpeta está en
//   .gitignore.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCSV, leerTexto } from '../lib/iter.js';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const CARPETA = path.join(process.env.NEXO_DATA || path.join(DIR, '..', 'data'), 'escuelas');
const ORIGINAL = path.join(CARPETA, 'original');
const SALIDA = path.join(CARPETA, 'escuelas_puebla.csv');
const entrada = process.argv[2] ? path.resolve(process.argv[2])
  : [path.join(CARPETA, 'cnct2026.csv'), path.join(ORIGINAL, 'cnct2026.csv')].find((r) => fs.existsSync(r));
if (!entrada || !fs.existsSync(entrada)) {
  console.error('No encontré el CNCT. Copia cnct2026.csv en data/escuelas/ o pasa la ruta: npm run escuelas:recortar -- ruta.csv');
  process.exit(1);
}

const norm = (s) => String(s || '').replace(/^﻿/, '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
const filas = parseCSV(leerTexto(entrada).replace(/^﻿/, ''));
const iEnt = filas[0].map(norm).indexOf('inmueble_c_nom_ent');
if (iEnt < 0) { console.error('El archivo no tiene la columna inmueble_c_nom_ent: ¿es el CNCT de la SEP?'); process.exit(1); }
const puebla = filas.slice(1).filter((f) => norm(f[iEnt]) === 'puebla');

const campo = (v) => (/[",\r\n]/.test(v) ? `"${String(v).replace(/"/g, '""')}"` : v);
const texto = `﻿${[filas[0].map((h) => campo(String(h).replace(/^﻿/, ''))), ...puebla.map((f) => f.map(campo))].map((f) => f.join(',')).join('\r\n')}\r\n`;
const tmp = `${SALIDA}.${process.pid}.tmp`;
fs.writeFileSync(tmp, texto);
fs.renameSync(tmp, SALIDA);

const mb = (b) => `${(b / 1024 / 1024).toFixed(1)} MB`;
console.log(`Leídos ${(filas.length - 1).toLocaleString('es-MX')} renglones de ${path.basename(entrada)} (${mb(fs.statSync(entrada).size)}).`);
console.log(`Guardados ${puebla.length.toLocaleString('es-MX')} renglones de Puebla en ${path.relative(process.cwd(), SALIDA)} (${mb(fs.statSync(SALIDA).size)}).`);
if (path.dirname(entrada) === CARPETA) {
  fs.mkdirSync(ORIGINAL, { recursive: true });
  const destino = path.join(ORIGINAL, path.basename(entrada));
  fs.renameSync(entrada, destino);
  console.log(`El archivo nacional se movió a ${path.relative(process.cwd(), destino)} para que el servidor no lo lea.`);
}
