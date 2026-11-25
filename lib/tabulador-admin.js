// Actualizar el tabulador CAPCEE: validar un CSV nuevo, compararlo con el actual,
// respaldar la versión anterior en data/capcee/historial/ y reemplazar sin dejar
// nunca un archivo a medias. Protegido con TABULADOR_ADMIN_KEY (ver server.js).
import fs from 'node:fs';
import path from 'node:path';
import { createHash, timingSafeEqual } from 'node:crypto';
import { procesarTabulador, huellaDe } from './tabulador.js';

export const LIMITE_BYTES = 1024 * 1024; // 1 MB
const BOM = Buffer.from([0xef, 0xbb, 0xbf]);

// ---------- Clave de administración ----------
// Compara en tiempo constante (sobre SHA-256 para igualar longitudes) para no filtrar la clave.
export function claveCorrecta(enviada, esperada) {
  if (!enviada || !esperada) return false;
  const h = (s) => createHash('sha256').update(String(s)).digest();
  return timingSafeEqual(h(enviada), h(esperada));
}

// ---------- Validación ----------
// Mismas reglas del lector (columnas, precio > 0, unidades, claves únicas, tipo_dato), pero
// aquí cualquier renglón inválido bloquea la carga: no se aplica un tabulador con errores.
export function validarCSV(buf) {
  if (!buf?.length) return { ok: false, errores: [{ fila: null, motivos: ['El archivo está vacío.'] }] };
  if (buf.length > LIMITE_BYTES) return { ok: false, errores: [{ fila: null, motivos: [`El archivo pesa ${(buf.length / 1048576).toFixed(2)} MB; el límite es 1 MB.`] }] };
  let texto;
  try { texto = new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch {
    return { ok: false, errores: [{ fila: null, motivos: ['El archivo no está en UTF-8. En Excel, guárdalo como "CSV UTF-8 (delimitado por comas)".'] }] };
  }
  let r;
  try { r = procesarTabulador(texto); } catch (e) { return { ok: false, errores: [{ fila: 1, motivos: [e.message] }] }; }
  if (r.rechazados.length) return { ok: false, errores: r.rechazados };
  if (!r.conceptos.length) return { ok: false, errores: [{ fila: null, motivos: ['El archivo no tiene conceptos.'] }] };
  // Se guarda siempre con BOM (formato del tabulador, para que Excel respete los acentos).
  const contenido = buf.subarray(0, 3).equals(BOM) ? buf : Buffer.concat([BOM, buf]);
  return { ok: true, conceptos: r.conceptos, contenido, huella: huellaDe(contenido) };
}

// ---------- Diferencias ----------
const CAMPOS = [
  ['precio', 'precio'], ['unidad', 'unidad'], ['partida_generica', 'partida genérica'],
  ['partida_especifica', 'partida específica'], ['factor_regional', 'factor'], ['tipo_dato', 'tipo de dato'],
  ['capitulo', 'capítulo'], ['concepto', 'nombre del concepto'], ['fuente', 'fuente'],
];
const r2 = (x) => Math.round(x * 100) / 100;

/**
 * Compara el catálogo actual con uno nuevo.
 * @param {object[]} actuales  conceptos del tabulador vigente
 * @param {object[]} nuevos    conceptos del CSV cargado
 * @param {object[]} guardados presupuestos guardados (para saber cuáles usan cada concepto)
 */
export function compararTabuladores(actuales, nuevos, guardados = []) {
  const usos = new Map();
  for (const p of guardados) for (const r of p.renglones || []) {
    if (!usos.has(r.clave_ref)) usos.set(r.clave_ref, new Set());
    usos.get(r.clave_ref).add(p.id);
  }
  const usadoEn = (clave) => usos.get(clave)?.size || 0;
  const antes = new Map(actuales.map((c) => [c.clave_ref, c]));
  const despues = new Map(nuevos.map((c) => [c.clave_ref, c]));

  const nuevosLst = nuevos.filter((c) => !antes.has(c.clave_ref))
    .map((c) => ({ clave_ref: c.clave_ref, concepto: c.concepto, unidad: c.unidad, precio: c.precio, tipo_dato: c.tipo_dato, fuente: c.fuente }));
  const eliminados = actuales.filter((c) => !despues.has(c.clave_ref))
    .map((c) => ({ clave_ref: c.clave_ref, concepto: c.concepto, unidad: c.unidad, precio: c.precio, tipo_dato: c.tipo_dato, fuente: c.fuente, presupuestos: usadoEn(c.clave_ref) }));
  const modificados = [];
  let sinCambio = 0;
  for (const n of nuevos) {
    const a = antes.get(n.clave_ref);
    if (!a) continue;
    const cambios = CAMPOS.filter(([k]) => a[k] !== n[k]).map(([k, nombre]) => ({ campo: k, nombre, antes: a[k], despues: n[k] }));
    if (!cambios.length) { sinCambio++; continue; }
    const precio = a.precio !== n.precio
      ? { antes: a.precio, despues: n.precio, difMxn: r2(n.precio - a.precio), difPct: Math.round(((n.precio - a.precio) / a.precio) * 1000) / 10 }
      : null;
    // tipo_dato y fuente son los del archivo nuevo: con ellos se etiqueta el precio nuevo.
    modificados.push({ clave_ref: n.clave_ref, concepto: n.concepto, unidad: n.unidad, tipo_dato: n.tipo_dato, fuente: n.fuente, cambios, precio, presupuestos: usadoEn(n.clave_ref) });
  }
  // Presupuestos guardados que usan algún concepto eliminado o modificado (cada uno se cuenta una vez).
  const afectados = new Set();
  for (const x of [...eliminados, ...modificados]) for (const id of usos.get(x.clave_ref) || []) afectados.add(id);
  return {
    nuevos: nuevosLst, eliminados, modificados, sinCambio,
    presupuestosAfectados: afectados.size,
    identico: !nuevosLst.length && !eliminados.length && !modificados.length,
  };
}

// ---------- Escritura segura ----------
// Escribe en un temporal del mismo directorio y lo renombra encima: el renombrado es atómico,
// así que quien lea el archivo ve el CSV viejo completo o el nuevo completo, nunca uno a medias.
export function escribirAtomico(ruta, contenido, { renombrar = fs.renameSync } = {}) {
  fs.mkdirSync(path.dirname(ruta), { recursive: true });
  const tmp = path.join(path.dirname(ruta), `.${path.basename(ruta)}.${process.pid}.${Date.now()}.tmp`);
  fs.writeFileSync(tmp, contenido);
  try { renombrar(tmp, ruta); } catch (e) {
    try { fs.unlinkSync(tmp); } catch { /* ya no existe */ }
    throw e;
  }
}

// tabulador_<AAAA-MM-DD_HHMMSS en hora de Puebla>_<huella corta>.csv
export const RE_RESPALDO = /^tabulador_(\d{4}-\d{2}-\d{2})_(\d{2})(\d{2})(\d{2})_([0-9a-f]{8})(?:-\d+)?\.csv$/;
export function nombreRespaldo(huella, fecha = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Mexico_City', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(fecha).map((x) => [x.type, x.value]));
  return `tabulador_${p.year}-${p.month}-${p.day}_${p.hour}${p.minute}${p.second}_${String(huella).slice(0, 8)}.csv`;
}

// Respalda el tabulador vigente (si existe) y escribe el nuevo de forma atómica.
export function reemplazarTabulador({ ruta, dirHistorial, contenido, ahora = new Date(), renombrar }) {
  let respaldo = null;
  if (fs.existsSync(ruta)) {
    fs.mkdirSync(dirHistorial, { recursive: true });
    const actual = fs.readFileSync(ruta);
    let nombre = nombreRespaldo(huellaDe(actual), ahora);
    for (let i = 2; fs.existsSync(path.join(dirHistorial, nombre)); i++) nombre = nombre.replace(/(-\d+)?\.csv$/, `-${i}.csv`);
    fs.writeFileSync(path.join(dirHistorial, nombre), actual, { flag: 'wx' });
    respaldo = nombre;
  }
  escribirAtomico(ruta, contenido, { renombrar });
  return { respaldo, huella: huellaDe(contenido) };
}

// Versiones anteriores, de la más reciente a la más antigua.
export function listarHistorial(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((a) => RE_RESPALDO.test(a)).map((archivo) => {
    const [, dia, hh, mm, ss] = archivo.match(RE_RESPALDO);
    const buf = fs.readFileSync(path.join(dir, archivo));
    const v = validarCSV(buf);
    return {
      archivo,
      fecha: `${dia} ${hh}:${mm}:${ss}`, // hora de Puebla
      huella: huellaDe(buf),
      conceptos: v.ok ? v.conceptos.length : null,
      valido: v.ok,
    };
  }).sort((a, b) => b.archivo.localeCompare(a.archivo));
}
