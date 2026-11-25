// Escuelas en el mapa: reglas visuales y agrupación por celda, sin librerías externas.
// Funciones puras (sin Leaflet ni DOM) para poder probarlas en Node (test/escuelas-mapa.test.js).
//
// Convención: cada señal significa una sola cosa.
// - Color del relleno = estado: rojo afectada grave/inhabitable · naranja afectada leve/moderada ·
//   amarillo en peligro sin daño · gris sin riesgo alto.
// - Borde punteado = SOLO daño por verificar.
// - Marcador hueco = ubicación dudosa (coordenada aproximada, o compartida por 3+ inmuebles).
// - Forma cuadrada (las localidades son círculos).
(function (raiz) {
  'use strict';
  const ZOOM_INDIVIDUAL = 12; // desde aquí se dibuja una escuela por marcador (solo las visibles)
  const CELDA_PX = 56; // tamaño de la celda de agrupación, en píxeles de pantalla
  const UMBRAL_COORD_COMPARTIDA = 3; // igual que lib/escuelas.js
  const ORDEN = ['rojo', 'naranja', 'amarillo', 'gris']; // de más a menos urgente

  // f: fila de /api/escuelas convertida a objeto.
  function categoria(f) {
    if (f.afectada && (f.dano === 'grave' || f.dano === 'inhabitable')) return 'rojo';
    if (f.afectada) return 'naranja';
    if (f.enPeligro) return 'amarillo';
    return 'gris';
  }
  const porVerificar = (f) => !!f.dano && f.danoVerificado === false;
  const dudosa = (f) => !!f.ubicacion_aproximada || (f.coordenada_compartida || 0) >= UMBRAL_COORD_COMPARTIDA;
  function claseMarcador(f) {
    return ['esc-m', `esc-${categoria(f)}`, porVerificar(f) ? 'esc-verificar' : '', dudosa(f) ? 'esc-dudosa' : ''].filter(Boolean).join(' ');
  }
  const ETIQUETA = {
    rojo: 'Afectada: daño grave o inhabitable', naranja: 'Afectada: daño leve o moderado', amarillo: 'En peligro, sin daño reportado', gris: 'Sin riesgo alto',
  };

  /**
   * Agrupa escuelas por celda de pantalla.
   * @param {object[]} filas  con lat y lon
   * @param {(f:object) => {x:number, y:number}} proyectar  coordenada → píxel al zoom actual
   * @param {number} celda  tamaño de la celda en píxeles
   * @returns {{n:number, lat:number, lon:number, categoria:string, cuenta:object, sur:number, oeste:number, norte:number, este:number, filas:object[]}[]}
   */
  function agrupar(filas, proyectar, celda = CELDA_PX) {
    const celdas = new Map();
    for (const f of filas) {
      const p = proyectar(f);
      const k = `${Math.floor(p.x / celda)},${Math.floor(p.y / celda)}`;
      let g = celdas.get(k);
      if (!g) {
        g = { n: 0, sLat: 0, sLon: 0, cuenta: { rojo: 0, naranja: 0, amarillo: 0, gris: 0 }, porVerificar: 0, sur: 90, norte: -90, oeste: 180, este: -180, filas: [] };
        celdas.set(k, g);
      }
      g.n++;
      g.sLat += f.lat; g.sLon += f.lon;
      g.cuenta[categoria(f)]++;
      if (porVerificar(f)) g.porVerificar++;
      g.sur = Math.min(g.sur, f.lat); g.norte = Math.max(g.norte, f.lat);
      g.oeste = Math.min(g.oeste, f.lon); g.este = Math.max(g.este, f.lon);
      g.filas.push(f);
    }
    return [...celdas.values()].map(({ sLat, sLon, ...g }) => ({
      ...g, lat: sLat / g.n, lon: sLon / g.n, categoria: ORDEN.find((c) => g.cuenta[c] > 0),
    }));
  }

  // Tamaño del cuadro de un grupo según cuántas escuelas tiene (22 a 36 px; la celda mide 56).
  const tamGrupo = (n) => Math.round(Math.min(36, 22 + 5 * Math.log10(Math.max(1, n))));

  // Texto corto del grupo para la etiqueta emergente y lectores de pantalla.
  function textoGrupo(g) {
    const partes = [];
    if (g.cuenta.rojo) partes.push(`${g.cuenta.rojo} con daño grave o inhabitable`);
    if (g.cuenta.naranja) partes.push(`${g.cuenta.naranja} con daño leve o moderado`);
    if (g.cuenta.amarillo) partes.push(`${g.cuenta.amarillo} en peligro`);
    if (g.cuenta.gris) partes.push(`${g.cuenta.gris} sin riesgo alto`);
    return `${g.n} escuelas: ${partes.join(', ')}${g.porVerificar ? ` (${g.porVerificar} por verificar)` : ''}`;
  }

  const api = { ZOOM_INDIVIDUAL, CELDA_PX, UMBRAL_COORD_COMPARTIDA, ORDEN, ETIQUETA, categoria, porVerificar, dudosa, claseMarcador, agrupar, tamGrupo, textoGrupo };
  raiz.PianiEscuelas = api;
})(typeof window !== 'undefined' ? window : globalThis);
