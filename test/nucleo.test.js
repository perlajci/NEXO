// Pruebas del núcleo con un CSV de PRUEBA (cifras inventadas solo para verificar el código).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { procesarITER, dmsADecimal, agregar } from '../lib/iter.js';
import { contiene, distanciaKm, cono, direccionMedia, destino } from '../lib/geo.js';
import { calcularVulnerabilidad, peligroVolcanico, indiceRiesgo, nivelDe } from '../lib/riesgo.js';
import { gutenbergRichter, climatologiaMensual } from '../lib/estadistica.js';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const csv = fs.readFileSync(path.join(DIR, 'fixture/iter/iter_prueba.csv'), 'utf8');

test('DMS a decimal en los tres formatos', () => {
  assert.ok(Math.abs(dmsADecimal('98°37\'00.000" W', 'lon') - -98.616667) < 1e-5);
  assert.ok(Math.abs(dmsADecimal('19°04\'30.000" N', 'lat') - 19.075) < 1e-6);
  assert.ok(Math.abs(dmsADecimal('0983700.000', 'lon') - -98.616667) < 1e-5);
  assert.equal(dmsADecimal('-98.5', 'lon'), -98.5);
  assert.equal(dmsADecimal('*', 'lat'), null);
});

test('ITER: omite totales y acumulados, respeta reservados', () => {
  const { localidades, resumen } = procesarITER(csv);
  assert.equal(localidades.length, 4);
  assert.equal(resumen.totalesOmitidos, 3);
  assert.equal(resumen.sinCoordenadas, 1);
  assert.equal(localidades[0].nom, 'Localidad Uno, Centro');
  const res = localidades.find((l) => l.nom === 'Localidad Reservada');
  assert.equal(res.POBTOT, 8);
  assert.equal(res.P_0A2, null);
  const ag = agregar(localidades);
  assert.equal(ag.total.POBTOT, 1000 + 500 + 300 + 8);
  assert.equal(ag.total.P_0A2, 40 + 15 + 9);
  assert.equal(ag.poblacionConDatoReservado.P_0A2, 8);
});

test('Geocerca círculo y polígono', () => {
  const { localidades } = procesarITER(csv);
  const circulo = { tipo: 'circulo', centro: [19.0225, -98.6278], radioKm: 12 };
  const dentro = localidades.filter((l) => contiene(circulo, l.lat, l.lon)).map((l) => l.nom);
  assert.deepEqual(dentro.sort(), ['Localidad Reservada', 'Localidad Uno, Centro']);
  const poli = { tipo: 'poligono', puntos: [[19.2, -98.4], [19.2, -98.2], [19.0, -98.2], [19.0, -98.4]] };
  assert.deepEqual(localidades.filter((l) => contiene(poli, l.lat, l.lon)).map((l) => l.nom), ['Localidad Dos']);
});

test('Geometría', () => {
  const d = distanciaKm(19.0, -98.0, 20.0, -98.0);
  assert.ok(Math.abs(d - 111.2) < 0.5);
  const [la, lo] = destino(19, -98, 90, 50);
  assert.ok(Math.abs(distanciaKm(19, -98, la, lo) - 50) < 0.01 && lo > -98);
  assert.equal(cono(19, -98, 90, 20, 100).length, 14);
  assert.ok(Math.abs(direccionMedia([350, 10]) - 0) < 1e-6 || Math.abs(direccionMedia([350, 10]) - 360) < 1e-6);
});

test('Vulnerabilidad y riesgo', () => {
  const { localidades } = procesarITER(csv);
  calcularVulnerabilidad(localidades);
  const dos = localidades.find((l) => l.nom === 'Localidad Dos');
  const tres = localidades.find((l) => l.nom === 'Localidad Tres');
  assert.ok(dos.V > tres.V, 'más lengua indígena no cuenta, pero sí sin salud/piso de tierra');
  assert.equal(localidades.find((l) => l.nom === 'Localidad Reservada').V, null);
  assert.equal(peligroVolcanico(19.03, -98.62), 1);
  assert.ok(peligroVolcanico(19.04, -98.2) <= 0.4);
  assert.equal(indiceRiesgo(1, 1), 1);
  assert.equal(indiceRiesgo(1, null), 0.75);
  assert.equal(nivelDe(0.75), 'muy_alto');
  assert.equal(nivelDe(0.1), 'bajo');
  assert.equal(indiceRiesgo(null, 0.5), null);
});

test('Gutenberg-Richter recupera b≈1 con datos sintéticos', () => {
  // Magnitudes con distribución exponencial b=1 (sintéticas, deterministas).
  const mags = [];
  for (let i = 1; i <= 4000; i++) { const u = i / 4001; mags.push(Math.round((4.45 - Math.log10(1 - u)) * 10) / 10); }
  const gr = gutenbergRichter(mags, 4.5, 40);
  assert.ok(gr.suficiente && Math.abs(gr.b - 1) < 0.08, `b=${gr.b}`);
  assert.equal(gutenbergRichter([5, 5.1], 4.5, 10).suficiente, false);
});

test('Climatología mensual', () => {
  const fechas = ['2020-01-01', '2020-01-02', '2021-01-01', '2020-07-01'];
  const c = climatologiaMensual(fechas, [10, 5, 3, 50], [-1, 2, -3, 12]);
  assert.equal(c[0].precip, 9); // (15 + 3) / 2 años
  assert.equal(c[0].heladas, 1); // 2 heladas / 2 años
  assert.equal(c[6].precip, 50);
});
