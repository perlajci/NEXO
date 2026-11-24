// Estadística sísmica y climática.

// Valor b de Gutenberg-Richter por máxima verosimilitud (Aki, 1965, con corrección de Utsu
// por el ancho del intervalo de magnitud). mc = magnitud de completitud.
export function gutenbergRichter(magnitudes, mc, anios, dM = 0.1) {
  const m = magnitudes.filter((x) => Number.isFinite(x) && x >= mc - 1e-9);
  const n = m.length;
  if (n < 20 || !(anios > 0)) return { n, suficiente: false };
  const media = m.reduce((a, b) => a + b, 0) / n;
  const b = Math.LOG10E / (media - (mc - dM / 2));
  const errorB = b / Math.sqrt(n); // Aki
  const a = Math.log10(n / anios) + b * mc; // tasa anual
  const tasa = (mag) => 10 ** (a - b * mag);
  const periodo = (mag) => 1 / tasa(mag);
  return {
    n,
    suficiente: true,
    b: r3(b),
    errorB: r3(errorB),
    a: r3(a),
    tasaAnual: { m5: r3(tasa(5)), m6: r3(tasa(6)), m7: r3(tasa(7)) },
    periodoRetornoAnios: { m6: r1(periodo(6)), m7: r1(periodo(7)) },
  };
}

// Histograma de magnitudes por intervalos de 0.5.
export function histogramaMagnitudes(magnitudes, desde = 4.5) {
  const bins = {};
  for (const x of magnitudes) {
    if (!Number.isFinite(x) || x < desde) continue;
    const k = (Math.floor(x * 2) / 2).toFixed(1);
    bins[k] = (bins[k] || 0) + 1;
  }
  return Object.entries(bins).sort((a, b) => Number(a[0]) - Number(b[0])).map(([desdeM, n]) => ({ desde: Number(desdeM), n }));
}

export function porAnio(fechas) {
  const c = {};
  for (const f of fechas) { const y = new Date(f).getUTCFullYear(); c[y] = (c[y] || 0) + 1; }
  return Object.entries(c).map(([anio, n]) => ({ anio: Number(anio), n })).sort((a, b) => a.anio - b.anio);
}

// Climatología mensual a partir de series diarias (fecha ISO, precipitación mm, temperatura mínima °C).
// precip = lluvia media acumulada en el mes; heladas = días promedio con Tmin < 0 °C.
export function climatologiaMensual(fechas, precip, tmin) {
  const acum = Array.from({ length: 12 }, () => ({ p: 0, h: 0, dias: 0 }));
  const aniosPorMes = Array.from({ length: 12 }, () => new Set());
  fechas.forEach((f, i) => {
    const mes = Number(f.slice(5, 7)) - 1;
    const anio = f.slice(0, 4);
    if (mes < 0 || mes > 11) return;
    const p = precip[i];
    const t = tmin[i];
    if (Number.isFinite(p)) acum[mes].p += p;
    if (Number.isFinite(t) && t < 0) acum[mes].h += 1;
    acum[mes].dias++;
    aniosPorMes[mes].add(anio);
  });
  return acum.map((a, i) => {
    const anios = aniosPorMes[i].size || 1;
    return { precip: r1(a.p / anios), heladas: r1(a.h / anios) };
  });
}

const r1 = (x) => Math.round(x * 10) / 10;
const r3 = (x) => Math.round(x * 1000) / 1000;
