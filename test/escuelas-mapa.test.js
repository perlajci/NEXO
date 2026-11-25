// Mapa de escuelas (paso 4): reglas visuales y agrupación (public/escuelas-mapa.js), correcciones de
// ubicación y abreviaturas de vialidad. Escuelas, CCT (21ZZZ…) y coordenadas INVENTADAS solo para probar.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { cargarEscuelasDesdeCarpeta, validarCorreccion, aplicarCorrecciones, ubicacionDudosa, inmuebleId } from '../lib/escuelas.js';

const DIR = path.dirname(fileURLToPath(import.meta.url));
// El archivo del navegador se carga tal cual, sin Leaflet ni DOM.
const ctx = {};
vm.runInNewContext(fs.readFileSync(path.join(DIR, '../public/escuelas-mapa.js'), 'utf8'), ctx);
const PE = ctx.PianiEscuelas;
const fila = (o) => ({ lat: 19, lon: -98, afectada: false, enPeligro: false, dano: null, danoVerificado: null, ubicacion_aproximada: false, coordenada_compartida: 0, ...o });

// ---------- Reglas visuales ----------
test('mapa: el color es el estado; afectada manda sobre en peligro', () => {
  assert.equal(PE.categoria(fila({ afectada: true, dano: 'inhabitable', enPeligro: true })), 'rojo');
  assert.equal(PE.categoria(fila({ afectada: true, dano: 'grave' })), 'rojo');
  assert.equal(PE.categoria(fila({ afectada: true, dano: 'moderado', enPeligro: true })), 'naranja');
  assert.equal(PE.categoria(fila({ afectada: true, dano: 'leve' })), 'naranja');
  assert.equal(PE.categoria(fila({ enPeligro: true })), 'amarillo');
  assert.equal(PE.categoria(fila({ enPeligro: true, dano: 'sin_dano', danoVerificado: true })), 'amarillo', 'sin daño no es afectada');
  assert.equal(PE.categoria(fila({})), 'gris');
});

test('mapa: borde punteado solo por daño por verificar; hueco solo por ubicación dudosa', () => {
  assert.equal(PE.claseMarcador(fila({ afectada: true, dano: 'grave', danoVerificado: false })), 'esc-m esc-rojo esc-verificar');
  assert.equal(PE.claseMarcador(fila({ afectada: true, dano: 'grave', danoVerificado: true })), 'esc-m esc-rojo');
  assert.equal(PE.claseMarcador(fila({ enPeligro: true, ubicacion_aproximada: true })), 'esc-m esc-amarillo esc-dudosa');
  assert.equal(PE.claseMarcador(fila({ coordenada_compartida: 2 })), 'esc-m esc-gris', 'compartida con menos de 3 no es dudosa');
  assert.equal(PE.claseMarcador(fila({ coordenada_compartida: 3 })), 'esc-m esc-gris esc-dudosa');
  assert.equal(PE.claseMarcador(fila({ enPeligro: true, dano: 'sin_dano', danoVerificado: false })), 'esc-m esc-amarillo esc-verificar', 'un "sin daño" pendiente también está por verificar');
});

test('mapa: agrupa por celda de pantalla, con el estado más urgente y su extensión', () => {
  const proyectar = (f) => ({ x: (f.lon + 99) * 1000, y: (20 - f.lat) * 1000 }); // 1 grado = 1000 px
  const filas = [
    fila({ lat: 19.001, lon: -98.001, enPeligro: true }),
    fila({ lat: 19.002, lon: -98.002, afectada: true, dano: 'leve', danoVerificado: false }),
    fila({ lat: 19.003, lon: -98.003 }),
    fila({ lat: 18.5, lon: -97.5, afectada: true, dano: 'grave', danoVerificado: true }),
  ];
  const grupos = PE.agrupar(filas, proyectar, 56).sort((a, b) => b.n - a.n);
  assert.equal(grupos.length, 2);
  const [g, solo] = grupos;
  assert.deepEqual([g.n, g.categoria, g.porVerificar], [3, 'naranja', 1]);
  assert.deepEqual({ ...g.cuenta }, { rojo: 0, naranja: 1, amarillo: 1, gris: 1 });
  assert.ok(Math.abs(g.lat - 19.002) < 1e-9 && Math.abs(g.lon + 98.002) < 1e-9, 'centro = promedio');
  assert.deepEqual([g.sur, g.norte, g.oeste, g.este], [19.001, 19.003, -98.003, -98.001]);
  assert.deepEqual([solo.n, solo.categoria], [1, 'rojo']);
  assert.equal(PE.textoGrupo(g), '3 escuelas: 1 con daño leve o moderado, 1 en peligro, 1 sin riesgo alto (1 por verificar)');
  assert.ok(PE.tamGrupo(1) >= 22 && PE.tamGrupo(100000) <= 36, 'el cuadro del grupo cabe en la celda');
});

test('mapa: 5 700 escuelas se agrupan rápido', () => {
  const muchas = Array.from({ length: 5700 }, (_, i) => fila({ lat: 18 + (i % 97) / 40, lon: -99 + (i % 89) / 35, enPeligro: i % 2 === 0 }));
  const t0 = process.hrtime.bigint();
  const g = PE.agrupar(muchas, (f) => ({ x: (f.lon + 99) * 200, y: (20 - f.lat) * 200 }));
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  assert.equal(g.reduce((a, x) => a + x.n, 0), 5700);
  assert.ok(ms < 200, `tardó ${ms.toFixed(1)} ms`);
});

// ---------- Tarjeta de Inicio ----------
test('tarjeta de Inicio: en peligro, afectadas y alumnos (sin inventar alumnos)', () => {
  const r = {
    enPeligro: 5677, inmueblesEnPeligro: 4183, afectadas: 3, inmueblesAfectados: 1, afectadasPorVerificar: 2,
    alumnosExpuestos: null, avisoAlumnos: 'El catálogo de escuelas no trae número de alumnos, así que no se pueden contar alumnos expuestos.',
  };
  const t = PE.tarjeta(r, 'Sísmico');
  assert.deepEqual([t.peligro, t.peligroDetalle, t.afectadas, t.afectadasDetalle, t.alumnos], ['5,677', 'en 4,183 inmuebles', '3', 'en 1 inmueble · 2 por verificar', 'Sin dato']);
  assert.match(t.nota, /^En peligro: estimación del modelo con Sísmico\. Afectadas: reportes de campo\. El catálogo de escuelas no trae/);
  assert.equal(t.etiqueta, 'Escuelas con Sísmico: 5,677 en peligro, 3 afectadas. Ver en el mapa.');
  const sinNada = PE.tarjeta({ ...r, enPeligro: 0, inmueblesEnPeligro: 0, afectadas: 0, inmueblesAfectados: 0, afectadasPorVerificar: 0, alumnosExpuestos: 0, avisoAlumnos: null }, 'Heladas, enero');
  assert.deepEqual([sinNada.peligroDetalle, sinNada.afectadasDetalle, sinNada.alumnos], ['', 'sin reportes de daño', '0'], 'con dato de alumnos, 0 sí se muestra');
});

// ---------- Vialidades ----------
test('inmueble: las abreviaturas de vialidad se escriben completas antes de comparar', () => {
  const id = (d) => inmuebleId(19, -98, d);
  for (const [a, b] of [['Av. Reforma 5', 'Avenida Reforma'], ['Blvd. Atlixco 10', 'Bulevar Atlixco'], ['Boulevard Atlixco', 'Blvd Atlixco'],
    ['C. Hidalgo 4', 'Calle Hidalgo'], ['Priv. Juárez', 'Privada Juarez 2'], ['Prol. 14 Sur 3', 'Prolongación 14 Sur'], ['Calz. Zavaleta', 'Calzada Zavaleta 1']]) {
    assert.equal(id(a), id(b), `${a} = ${b}`);
  }
  assert.notEqual(id('Calle 9 Sur'), id('Calle 21 Sur'), 'el número de la calle sí cuenta');
  assert.notEqual(id('Calle 5 C'), id('Calle 5'), '"C" solo es Calle al inicio');
});

// ---------- Correcciones de ubicación ----------
const CSV = `cct,nombre,nivel,latitud,longitud,vialidad,colonia
21ZZZ0301A,Primaria de prueba (dato inventado),primaria,19.05,-98.6,Calle Uno 1,Centro
21ZZZ0302B,Secundaria de prueba (dato inventado),secundaria,19.05,-98.6,Calle Uno,Centro
21ZZZ0303C,Preescolar de prueba (dato inventado),preescolar,19.05,-98.6,Calle Dos,Centro
21ZZZ0304D,Primaria de prueba en otra calle (dato inventado),primaria,19.05,-98.6,Calle Tres,Centro
21ZZZ0305E,Primaria aproximada de prueba (dato inventado),primaria,18.51,-97.51,Calle Cuatro,Centro
`;

test('correcciones: validan Puebla y distancia, y mueven todo el inmueble sin tocar el original', () => {
  const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'nexo-corr-'));
  fs.writeFileSync(path.join(carpeta, 'e.csv'), CSV);
  const { escuelas } = cargarEscuelasDesdeCarpeta(carpeta);
  const a = escuelas.find((e) => e.cct === '21ZZZ0301A');
  assert.throws(() => validarCorreccion({ lat: 19.43, lon: -99.13 }, a), /fuera de Puebla/);
  assert.throws(() => validarCorreccion({ lat: 19.3, lon: -98.6 }, a), /a 27\.8 km/);
  assert.throws(() => validarCorreccion({ lat: 'x', lon: 1 }, a), /inválida/);
  const c = validarCorreccion({ lat: 19.0512345, lon: -98.6012345, nota: 'Visita de prueba' }, a, { ahora: new Date('2026-11-25T12:00:00Z') });
  assert.deepEqual([c.id, c.cct, c.fuente, c.lat, c.anterior.lat], [a.inmueble_id, '21ZZZ0301A', 'manual', 19.051235, 19.05]);

  const corregidas = aplicarCorrecciones(escuelas, [c]);
  const por = (cct) => corregidas.find((e) => e.cct === cct);
  assert.deepEqual([por('21ZZZ0301A').lat, por('21ZZZ0302B').lat], [19.051235, 19.051235], 'mueve las dos CCT del mismo inmueble');
  assert.equal(por('21ZZZ0302B').fuente_coord, 'manual');
  assert.deepEqual(por('21ZZZ0302B').coord_original, { lat: 19.05, lon: -98.6, decimales_coord: 'baja', fuente: 'Catálogo CCT (SEP)' });
  assert.equal(por('21ZZZ0302B').ubicacion_aproximada, false, 'corregida deja de ser aproximada');
  assert.deepEqual([por('21ZZZ0303C').lat, por('21ZZZ0303C').fuente_coord], [19.05, 'Catálogo CCT (SEP)'], 'otra calle en el mismo punto no se mueve');
  assert.equal(escuelas.find((e) => e.cct === '21ZZZ0301A').lat, 19.05, 'el catálogo original no cambia');

  // Ubicación dudosa: aproximada (pocos decimales) y/o compartida por 3 o más inmuebles.
  assert.deepEqual(ubicacionDudosa(escuelas.find((e) => e.cct === '21ZZZ0303C')), ['aproximada', 'compartida']);
  assert.deepEqual(ubicacionDudosa(por('21ZZZ0301A')), null);
});

// ---------- API ----------
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nexo-mapa-api-'));
for (const d of ['iter', 'cache', 'escuelas']) fs.mkdirSync(path.join(tmp, d));
fs.copyFileSync(path.join(DIR, 'fixture/iter/iter_prueba.csv'), path.join(tmp, 'iter/iter_prueba.csv'));
fs.writeFileSync(path.join(tmp, 'escuelas/e.csv'), CSV);
fs.writeFileSync(path.join(tmp, 'cache', 'usgs_1980-01-01_4.5.json'), JSON.stringify({ fuente: 'prueba', desde: '1980-01-01', magMin: 4.5, eventos: [] }));
process.env.NEXO_DATA = tmp;
process.env.PORT = '0';
delete process.env.PIANI_CLAVE;
const { iniciar, servidor } = await import('../server.js');
await iniciar();
const base = `http://127.0.0.1:${servidor.address().port}`;
const pedir = (p, metodo = 'GET', b) => fetch(base + p, { method: metodo, headers: { 'content-type': 'application/json' }, body: b === undefined ? undefined : JSON.stringify(b) })
  .then(async (r) => ({ s: r.status, j: await r.json() }));
test.after(() => servidor.close());
const filasDe = (j) => j.datos.map((d) => Object.fromEntries(j.columnas.map((c, i) => [c, d[i]])));

test('API mapa: columnas para dibujar y motivo de ubicación dudosa en la ficha', async () => {
  const l = filasDe((await pedir('/api/escuelas?estado=todas')).j);
  const c = l.find((f) => f.cct === '21ZZZ0303C');
  assert.deepEqual([c.coordenada_compartida, c.ubicacion_aproximada, c.fuente_coord, c.domicilio], [3, true, 'Catálogo CCT (SEP)', 'Calle Dos, Centro']);
  const f = (await pedir('/api/escuela/21ZZZ0303C')).j;
  assert.deepEqual(f.ubicacionDudosa, ['aproximada', 'compartida']);
});

test('API mapa: corregir ubicación guarda aparte, mueve el inmueble y se puede deshacer', async () => {
  const mal = await pedir('/api/escuelas/21ZZZ0301A/ubicacion', 'POST', { lat: 19.43, lon: -99.13 });
  assert.equal(mal.s, 400);
  const ok = await pedir('/api/escuelas/21ZZZ0301A/ubicacion', 'POST', { lat: 19.0525, lon: -98.6025, nota: 'Prueba' });
  assert.equal(ok.s, 200);
  assert.deepEqual(ok.j.escuelas.sort(), ['21ZZZ0301A', '21ZZZ0302B']);
  const guardado = JSON.parse(fs.readFileSync(path.join(tmp, 'escuelas', 'correcciones.json'), 'utf8'));
  assert.deepEqual([guardado.length, guardado[0].fuente, guardado[0].lat], [1, 'manual', 19.0525]);
  assert.match(fs.readFileSync(path.join(tmp, 'escuelas', 'e.csv'), 'utf8'), /21ZZZ0301A,.*,19\.05,-98\.6,/, 'el CSV original no cambia');

  let l = filasDe((await pedir('/api/escuelas?estado=todas')).j);
  const b = l.find((f) => f.cct === '21ZZZ0302B');
  assert.deepEqual([b.lat, b.lon, b.fuente_coord, b.ubicacion_aproximada], [19.0525, -98.6025, 'manual', false]);
  const ficha = (await pedir('/api/escuela/21ZZZ0302B')).j;
  assert.ok(ficha.avisos.some((a) => /Ubicación corregida a mano \(CCT 21ZZZ0301A/.test(a)));

  assert.equal((await pedir('/api/escuelas/21ZZZ0302B/ubicacion', 'DELETE')).j.ok, true, 'cualquier CCT del inmueble la deshace');
  l = filasDe((await pedir('/api/escuelas?estado=todas')).j);
  assert.equal(l.find((f) => f.cct === '21ZZZ0302B').lat, 19.05);
  assert.equal((await pedir('/api/escuelas/21ZZZ9999Z/ubicacion', 'POST', { lat: 19, lon: -98 })).s, 404);
});
