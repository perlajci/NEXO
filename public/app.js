// NEXO v0.2 · interfaz por secciones. Todo texto que viene de datos se escapa antes de insertarse.
(() => {
  'use strict';
  // ---------- Utilidades ----------
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (n, d = 0) => (n === null || n === undefined || !Number.isFinite(Number(n)) ? '–' : Number(n).toLocaleString('es-MX', { maximumFractionDigits: d }));
  const pct = (a, b) => (b > 0 && Number.isFinite(a) ? (100 * a) / b : 0);
  const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
  const COLOR = { bajo: '#3f9b6b', medio: '#e0ad2f', alto: '#e3742b', muy_alto: '#c3262f', sin_dato: '#9aa0a6' };
  const NIV_ORDEN = ['muy_alto', 'alto', 'medio', 'bajo', 'sin_dato'];
  const NOM_NIV = { muy_alto: 'Muy alto', alto: 'Alto', medio: 'Medio', bajo: 'Bajo', sin_dato: 'Sin dato' };
  const NOM_NEC = { agua: 'Agua', alimentos: 'Alimentos', medicinas: 'Medicinas', atencion_medica: 'Atención médica', cobijas: 'Cobijas', traslado: 'Traslado', energia: 'Energía', comunicacion: 'Comunicación' };
  const NOM_TIPO = { albergue: 'Albergue', base: 'Base', reporte: 'Reporte' };
  const COLOR_TIPO = { albergue: '#2f8f5b', base: '#1f5fbf', reporte: '#e3742b' };
  const etiquetaNivel = (n) => `<span class="nivel" style="background:${COLOR[n || 'sin_dato']}">${NOM_NIV[n || 'sin_dato']}</span>`;

  const api = async (ruta, opciones) => {
    const r = await fetch(ruta, opciones);
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(j.error || `Error ${r.status}`), { status: r.status });
    return j;
  };
  const postJSON = (ruta, cuerpo) => api(ruta, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) });

  const st = {
    meta: null, sec: 'inicio', modo: 'circulo', geocerca: null, vertices: [], ultimo: null,
    ubicando: false, rutaMarcando: null, ruta: { origen: null, destino: null }, punto: null,
    resumen: {}, munOrden: 'riesgo', conf: [], filtroConf: 'todos',
  };
  const escenario = () => ({ fenomeno: $('#fFenomeno').value, mes: Number($('#fMes').value) });
  const claveEsc = () => { const e = escenario(); return `${e.fenomeno}-${e.mes}`; };

  // ---------- Mapa y capas ----------
  const mapa = L.map('mapa', { preferCanvas: true }).setView([19.0, -97.9], 8);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 18, attribution: '&copy; OpenStreetMap · Datos: INEGI ITER 2020, USGS, Open-Meteo',
  }).addTo(mapa);
  const capas = {};
  for (const k of ['loc', 'geo', 'vert', 'conf', 'popo', 'mun', 'alb', 'ruta', 'sis', 'punto']) capas[k] = L.layerGroup();
  const CAPAS_SEC = {
    inicio: ['loc', 'popo', 'conf'], riesgo: ['loc', 'popo', 'conf'], contar: ['loc', 'geo', 'vert', 'conf'],
    municipios: ['mun', 'geo'], albergues: ['loc', 'alb'], operacion: ['loc', 'geo', 'conf'],
    rutas: ['conf', 'ruta'], sismos: ['sis', 'punto', 'geo'], clima: ['punto', 'geo'], ayuda: ['loc'],
  };
  function mostrarCapas(sec) {
    const quiero = new Set(CAPAS_SEC[sec] || []);
    if (sec === 'riesgo' || sec === 'inicio') {
      if (!$('#capaPopo').checked) quiero.delete('popo');
      if (!$('#capaPuntos').checked) quiero.delete('conf');
    }
    for (const [k, c] of Object.entries(capas)) {
      if (quiero.has(k)) c.addTo(mapa); else mapa.removeLayer(c);
    }
  }
  const pista = (txt) => { $('#pista').hidden = !txt; $('#pista').textContent = txt || ''; };

  // ---------- Navegación ----------
  const SECCIONES = ['inicio', 'riesgo', 'contar', 'municipios', 'albergues', 'operacion', 'rutas', 'sismos', 'clima', 'ayuda'];
  function irA(sec) {
    if (!SECCIONES.includes(sec)) sec = 'inicio';
    st.sec = sec;
    $$('.riel button').forEach((b) => { const a = b.dataset.sec === sec; b.classList.toggle('activo', a); if (a) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
    $$('.sec').forEach((s) => { s.hidden = s.dataset.sec !== sec; });
    document.body.classList.toggle('ancho', sec === 'municipios');
    st.ubicando = false; st.rutaMarcando = null;
    pista(sec === 'contar' && !st.geocerca ? 'Da clic en el mapa para poner el centro de la zona' : '');
    mostrarCapas(sec);
    $('#panel').scrollTop = 0;
    if (location.hash !== `#${sec}`) history.replaceState(null, '', `#${sec}`);
    setTimeout(() => mapa.invalidateSize && mapa.invalidateSize(), 50);
    if (sec === 'riesgo' || sec === 'inicio') cargarResumen().then(pintarRiesgo).catch(() => {});
    if (sec === 'municipios') cargarResumen().then(pintarMunicipios).catch(() => {});
    if (sec === 'operacion' || sec === 'rutas') cargarConfirmaciones();
    if (sec === 'sismos' || sec === 'clima') textoCentro();
  }
  $$('.riel button').forEach((b) => b.addEventListener('click', () => irA(b.dataset.sec)));
  document.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-ir]');
    if (!b) return;
    ev.preventDefault();
    irA(b.dataset.ir);
  });
  window.addEventListener('hashchange', () => irA(location.hash.slice(1)));

  // ---------- Escenario y filtros ----------
  function montarFiltros(meta) {
    $('#fFenomeno').innerHTML = Object.entries(meta.fenomenos).map(([k, v]) => `<option value="${esc(k)}">${esc(v.nombre)}</option>`).join('');
    const mesActual = new Date().getMonth() + 1;
    $('#fMes').innerHTML = MESES.map((m, i) => `<option value="${i + 1}" ${i + 1 === mesActual ? 'selected' : ''}>${m}</option>`).join('');
    $('#fNiveles').innerHTML = NIV_ORDEN.slice(0, 4).map((n) => `<label><input type="checkbox" value="${n}"><span class="punto" style="background:${COLOR[n]}"></span>${NOM_NIV[n]}</label>`).join('');
    $('#cNec').innerHTML = meta.necesidades.map((n) => `<label><input type="checkbox" name="nec" value="${esc(n)}">${esc(NOM_NEC[n] || n)}</label>`).join('');
    $('#leyenda').innerHTML = NIV_ORDEN.map((n) => `<span><i style="background:${COLOR[n]}"></i>${NOM_NIV[n]}</span>`).join('');
    notaMes();
  }
  function notaMes() {
    const est = st.meta?.fenomenos[$('#fFenomeno').value]?.estacional;
    $('#fMes').disabled = !est;
    $('#fMes').title = est ? '' : 'Este fenómeno no depende del mes';
    $('#notaMes').textContent = est
      ? (st.meta.clima ? 'El peligro cambia según la climatología del mes elegido.' : 'Falta la climatología: usa “Descargar clima” en la barra superior.')
      : 'Volcán y sismos no dependen de la temporada: el mes no cambia el resultado.';
  }
  const filtrosMapa = () => ({
    mun: $('#fMun').value || null,
    niveles: $$('#fNiveles input:checked').map((i) => i.value),
    pobMin: Math.max(0, Number($('#fPobMin').value) || 0),
  });

  // ---------- Estado de datos ----------
  function pintarEstado(e) {
    const chips = [];
    chips.push(e.iter ? `<span class="chip">Censo: ${fmt(e.iter.localidades)} localidades</span>` : '<span class="chip mal">Censo no cargado</span>');
    if (e.sismos) chips.push(`<span class="chip">Sismos: ${fmt(e.sismos.eventos)}</span>`);
    else chips.push(`<span class="chip ${e.errores.sismos ? 'mal' : ''}">Sismos: ${esc(e.errores.sismos ? 'sin conexión' : 'descargando…')}</span>`);
    if (e.clima) chips.push(`<span class="chip">Clima ${esc(e.clima.inicio.slice(0, 4))}–${esc(e.clima.fin.slice(0, 4))}</span>`);
    else if (e.trabajos.clima === 'descargando') chips.push(`<span class="chip">${esc(e.trabajos.climaProgreso || 'Clima: descargando…')}</span>`);
    else chips.push(`<span class="chip ${e.errores.clima ? 'mal' : ''}">Sin climatología<button type="button" id="btnPrepClima">Descargar clima</button></span>`);
    $('#estadoDatos').innerHTML = chips.join('');
    const b = $('#btnPrepClima');
    if (b) b.onclick = async () => { await postJSON('/api/preparar/clima', {}).catch(() => null); vigilar(); };
    $('#sinDatos').hidden = !!e.iter;
    const item = (ok, txt) => `<li><span class="${ok ? 'si' : 'no'}">${ok ? '✓' : '✗'}</span><span>${txt}</span></li>`;
    $('#checklist').innerHTML = [
      item(!!e.iter, e.iter ? `Censo 2020 cargado: ${fmt(e.iter.localidades)} localidades con coordenadas.` : 'Falta el CSV del censo (ITER 2020) en data/iter/.'),
      item(!!e.sismos, e.sismos ? `Catálogo sísmico: ${fmt(e.sismos.eventos)} sismos desde ${esc(e.sismos.desde.slice(0, 4))}.` : 'Catálogo sísmico pendiente (requiere internet).'),
      item(!!e.clima, e.clima ? 'Climatología mensual lista (lluvias y heladas).' : 'Climatología pendiente: botón “Descargar clima” arriba.'),
      item(true, e.rutas === 'google' ? 'Rutas con Google Maps (con tráfico).' : 'Rutas con OpenStreetMap/OSRM (agrega GOOGLE_MAPS_API_KEY para usar Google).'),
    ].join('');
  }
  let vigilando = null;
  function vigilar() {
    clearInterval(vigilando);
    vigilando = setInterval(async () => {
      const e = await api('/api/estado').catch(() => null);
      if (!e) return;
      const antes = st.meta;
      st.meta = { ...st.meta, ...e };
      pintarEstado(e);
      if (e.trabajos.sismos !== 'descargando' && e.trabajos.clima !== 'descargando') {
        clearInterval(vigilando);
        if ((!antes.sismos && e.sismos) || (!antes.clima && e.clima)) { st.resumen = {}; notaMes(); recargarEscenario(); }
      }
    }, 4000);
  }

  // ---------- Localidades (mapa de riesgo) ----------
  async function cargarLocalidades() {
    if (!st.meta?.iter) return;
    const e = escenario();
    const f = filtrosMapa();
    const r = await api(`/api/localidades?fenomeno=${encodeURIComponent(e.fenomeno)}&mes=${e.mes}`);
    const c = Object.fromEntries(r.columnas.map((k, i) => [k, i]));
    capas.loc.clearLayers();
    for (const d of r.datos) {
      if (f.mun && d[c.mun] !== f.mun) continue;
      if (f.pobMin && (d[c.POBTOT] || 0) < f.pobMin) continue;
      const nivel = d[c.nivel] || 'sin_dato';
      if (f.niveles.length && !f.niveles.includes(nivel)) continue;
      L.circleMarker([d[c.lat], d[c.lon]], { radius: Math.max(2, Math.min(14, Math.sqrt(d[c.POBTOT] || 1) / 9)), weight: 0.6, color: '#1b1b1b', fillColor: COLOR[nivel], fillOpacity: 0.78 })
        .bindPopup(() => `<strong>${esc(d[c.nom])}</strong><br>${esc(d[c.nomMun])}<br>Población: ${fmt(d[c.POBTOT])}<br>Vulnerabilidad: ${d[c.V] ?? 'sin dato'} · Peligro: ${d[c.P] ?? 'sin dato'}<br>Riesgo: ${d[c.R] ?? 'sin dato'} ${etiquetaNivel(nivel)}`)
        .addTo(capas.loc);
    }
  }
  async function cargarMunicipiosLista() {
    if (!st.meta?.iter) return;
    const lista = await api('/api/municipios');
    const opts = lista.map((m) => `<option value="${esc(m.mun)}">${esc(m.nombre)}</option>`).join('');
    $('#fMun').innerHTML = `<option value="">Todos</option>${opts}`;
    $('#aMun').innerHTML = `<option value="">Todo el estado</option>${opts}`;
  }
  async function cargarResumen() {
    if (!st.meta?.iter) throw new Error('sin censo');
    const k = claveEsc();
    if (!st.resumen[k]) { const e = escenario(); st.resumen[k] = await api(`/api/municipios/resumen?fenomeno=${e.fenomeno}&mes=${e.mes}`); }
    return st.resumen[k];
  }

  function barraNiveles(porNivel) {
    const tot = NIV_ORDEN.reduce((a, k) => a + (porNivel[k]?.poblacion ?? porNivel[k] ?? 0), 0) || 1;
    const v = (k) => porNivel[k]?.poblacion ?? porNivel[k] ?? 0;
    return `<div class="apilada" role="img" aria-label="Población por nivel de riesgo">${NIV_ORDEN.map((k) => `<i style="width:${pct(v(k), tot)}%;background:${COLOR[k]}"></i>`).join('')}</div>
      <div class="claves">${NIV_ORDEN.filter((k) => v(k) > 0).map((k) => `<span><i style="background:${COLOR[k]}"></i>${NOM_NIV[k]}: ${fmt(v(k))} (${pct(v(k), tot).toFixed(1)}%)</span>`).join('')}</div>`;
  }

  function pintarRiesgo(r) {
    const e = r.estatal;
    const altos = e.porNivel.alto + e.porNivel.muy_alto;
    const munMuyAlto = r.municipios.filter((m) => m.nivel === 'muy_alto').length;
    $('#rKpis').innerHTML = `
      <div><b>${fmt(e.poblacion)}</b><small>habitantes en ${fmt(e.localidades)} localidades</small></div>
      <div><b>${fmt(altos)}</b><small>en riesgo alto o muy alto (${pct(altos, e.poblacion).toFixed(1)}%)</small></div>
      <div><b>${fmt(munMuyAlto)}</b><small>municipios con riesgo promedio muy alto</small></div>
      <div><b>${fmt(e.P_60YMAS)}</b><small>personas de 60 años y más en el estado</small></div>`;
    $('#rNivelesEst').innerHTML = barraNiveles(e.porNivel);
  }

  // ---------- Contar población (geocerca) ----------
  function centro(g) {
    if (!g) return null;
    if (g.tipo === 'circulo') return g.centro;
    const n = g.puntos.length;
    return [g.puntos.reduce((a, p) => a + p[0], 0) / n, g.puntos.reduce((a, p) => a + p[1], 0) / n];
  }
  function dibujarGeocerca(g, ajustar = true) {
    capas.geo.clearLayers(); capas.vert.clearLayers();
    if (!g) return;
    const estilo = { color: '#0e5a7a', weight: 2.5, fillOpacity: 0.08, dashArray: '6 4' };
    const c = g.tipo === 'circulo' ? L.circle(g.centro, { ...estilo, radius: g.radioKm * 1000 }) : L.polygon(g.puntos, estilo);
    c.addTo(capas.geo);
    if (ajustar) mapa.fitBounds(c.getBounds(), { padding: [30, 30], maxZoom: 12 });
  }
  async function calcular(g) {
    if (g) st.geocerca = g;
    if (!st.geocerca || !st.meta?.iter) return;
    const e = escenario();
    const f = filtrosMapa();
    try {
      const r = await postJSON('/api/geocerca', { geocerca: st.geocerca, fenomeno: e.fenomeno, mes: e.mes, filtros: { mun: f.mun, niveles: f.niveles, pobMin: f.pobMin } });
      st.ultimo = r;
      pintarPoblacion(r);
      pintarOperacion(r);
      textoCentro();
      pista('');
    } catch (err) { $('#rNota').textContent = err.message; }
  }
  function barra(etq, valor, base, unidad = '') {
    const p = pct(valor, base);
    return `<div class="b"><span>${esc(etq)}</span><span class="v">${fmt(valor)} · ${p.toFixed(1)}% ${esc(unidad)}</span><span class="t"><i style="width:${Math.min(100, p)}%"></i></span></div>`;
  }
  const htmlGrupos = (t) => [
    barra('Bebés de 0 a 2 años', t.P_0A2, t.POBTOT, 'de la población'),
    barra('Personas de 60 años y más', t.P_60YMAS, t.POBTOT),
    barra('Personas con discapacidad', t.PCON_DISC, t.POBTOT),
    barra('Hablan lengua indígena (3+ años)', t.P3YM_HLI, t.POBTOT),
    barra('Sin afiliación a servicios de salud', t.PSINDER, t.POBTOT),
  ].join('');
  const htmlViv = (t) => `<p class="nota">${fmt(t.TVIVHAB)} viviendas habitadas</p>${[
    barra('Con piso de tierra', t.VPH_PISOTI, t.TVIVHAB, 'de viviendas'),
    barra('Sin energía eléctrica', t.VPH_S_ELEC, t.TVIVHAB),
    barra('Sin agua entubada', t.VPH_AGUAFV, t.TVIVHAB),
  ].join('')}`;
  const textoReservado = (res) => {
    const m = Math.max(0, ...Object.values(res));
    return m > 0 ? `${fmt(m)} personas viven en localidades con datos reservados por el INEGI (*): los conteos de grupos son un mínimo.` : '';
  };
  const filasLocalidades = (lista, n = 60) => lista.slice(0, n).map((l) => `<tr><td data-l="Localidad">${esc(l.nom)}</td><td data-l="Municipio">${esc(l.nomMun)}</td><td class="n" data-l="Población">${fmt(l.POBTOT)}</td><td class="n" data-l="0–2 / 60+">${fmt(l.P_0A2)} / ${fmt(l.P_60YMAS)}</td><td data-l="Riesgo">${etiquetaNivel(l.nivel)}</td></tr>`).join('');

  function pintarPoblacion(r) {
    const t = r.agregados.total;
    $('#resVacio').hidden = true;
    $('#resPob').hidden = false;
    $('#rTotal').textContent = fmt(t.POBTOT);
    $('#rSub').textContent = `${fmt(r.totalLocalidades)} localidades · ${fmt(t.POBFEM)} mujeres, ${fmt(t.POBMAS)} hombres · ${fmt(r.municipios.length)} municipios`;
    $('#rGrupos').innerHTML = htmlGrupos(t);
    $('#rViv').innerHTML = htmlViv(t);
    $('#rReservado').textContent = textoReservado(r.agregados.poblacionConDatoReservado);
    $('#rNiveles').innerHTML = barraNiveles(r.porNivel);
    $('#rMun tbody').innerHTML = r.municipios.slice(0, 40).map((m) => `<tr><td>${esc(m.nombre)}</td><td class="n">${fmt(m.localidades)}</td><td class="n">${fmt(m.poblacion)}</td></tr>`).join('');
    $('#rLoc tbody').innerHTML = filasLocalidades(r.localidades);
    $('#rNota').textContent = r.totalLocalidades > 60 ? `Se muestran 60 de ${fmt(r.totalLocalidades)}; el CSV trae hasta 300.` : '';
  }

  function descargarCSV() {
    const r = st.ultimo;
    if (!r) return;
    const cab = ['clave', 'localidad', 'municipio', 'poblacion', 'p_0a2', 'p_60ymas', 'pcon_disc', 'vulnerabilidad', 'peligro', 'riesgo', 'nivel'];
    const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const filas = r.localidades.map((l) => [l.id, l.nom, l.nomMun, l.POBTOT, l.P_0A2, l.P_60YMAS, l.PCON_DISC, l.V, l.p, l.r, l.nivel].map(q).join(','));
    const blob = new Blob([`﻿${[cab.join(','), ...filas].join('\n')}`], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `nexo_zona_${r.fenomeno}_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  function modo(m) {
    st.modo = m;
    $('#mCirculo').classList.toggle('activo', m === 'circulo');
    $('#mPoligono').classList.toggle('activo', m === 'poligono');
    $('#opCirculo').hidden = m !== 'circulo';
    $('#opPoligono').hidden = m !== 'poligono';
    st.vertices = []; capas.vert.clearLayers(); $('#nVert').textContent = '0';
    pista(m === 'circulo' ? 'Da clic en el mapa para poner el centro' : 'Da clic en el mapa para agregar vértices');
  }
  $('#mCirculo').onclick = () => modo('circulo');
  $('#mPoligono').onclick = () => modo('poligono');
  function pintarVertices() {
    capas.vert.clearLayers();
    st.vertices.forEach((v) => L.circleMarker(v, { radius: 4, color: '#0e5a7a', fillOpacity: 1 }).addTo(capas.vert));
    if (st.vertices.length > 1) L.polyline(st.vertices, { color: '#0e5a7a', dashArray: '4 4' }).addTo(capas.vert);
    $('#nVert').textContent = String(st.vertices.length);
  }
  $('#radio').addEventListener('input', () => { $('#radioTxt').textContent = $('#radio').value; });
  $('#radio').addEventListener('change', () => {
    if (st.geocerca?.tipo !== 'circulo') return;
    const g = { ...st.geocerca, radioKm: Number($('#radio').value) };
    dibujarGeocerca(g); calcular(g);
  });
  $('#btnDeshacer').onclick = () => { st.vertices.pop(); pintarVertices(); };
  $('#btnCerrar').onclick = () => {
    if (st.vertices.length < 3) { pista('El polígono necesita al menos 3 vértices'); return; }
    const g = { tipo: 'poligono', puntos: st.vertices.slice() };
    st.vertices = [];
    dibujarGeocerca(g); calcular(g);
  };
  $('#btnLimpiar').onclick = () => {
    st.geocerca = null; st.ultimo = null; st.vertices = [];
    dibujarGeocerca(null);
    $('#resVacio').hidden = false; $('#resPob').hidden = true; $('#infoCeniza').textContent = '';
    pintarOperacion(null);
  };
  $$('[data-preset]').forEach((b) => b.addEventListener('click', async () => {
    const v = st.meta?.volcanes?.[0] || { lat: 19.0225, lon: -98.6278 };
    const p = b.dataset.preset;
    $('#infoCeniza').textContent = '';
    if (p === 'popo12' || p === 'popo30') {
      const r = p === 'popo12' ? 12 : 30;
      $('#radio').value = r; $('#radioTxt').textContent = r; modo('circulo');
      const g = { tipo: 'circulo', centro: [v.lat, v.lon], radioKm: r };
      dibujarGeocerca(g); calcular(g);
    } else if (p === 'estado') {
      const g = { tipo: 'circulo', centro: [19.0, -97.9], radioKm: 320 };
      dibujarGeocerca(g); calcular(g);
    } else if (p === 'ceniza') {
      $('#infoCeniza').textContent = 'Consultando viento en altura…';
      try {
        const r = await api('/api/ceniza?horas=24');
        const g = { tipo: 'poligono', puntos: r.poligono };
        dibujarGeocerca(g); calcular(g);
        $('#infoCeniza').textContent = `El viento a ~5.5 km sopla desde ${r.vientoDesde}° a ${r.velocidadMediaKmh} km/h: la ceniza iría hacia ${r.haciaGrados}° en las próximas ${r.horas} h. Aproximación.`;
      } catch (err) { $('#infoCeniza').textContent = err.message; }
    }
  }));
  $('#btnCSV').onclick = descargarCSV;

  // ---------- Tablero de municipios ----------
  const METRICAS = {
    riesgo: { nom: 'Índice de riesgo', v: (m) => m.riesgo, f: (x) => (x ?? 0).toFixed(3), max: 1 },
    pctRiesgoAlto: { nom: '% en riesgo alto o muy alto', v: (m) => m.pctRiesgoAlto, f: (x) => `${fmt(x, 1)}%`, max: 100 },
    poblacion: { nom: 'Población', v: (m) => m.poblacion, f: fmt },
    vulnerabilidad: { nom: 'Vulnerabilidad', v: (m) => m.vulnerabilidad, f: (x) => (x ?? 0).toFixed(3), max: 1 },
    P_60YMAS: { nom: 'Personas de 60 y más', v: (m) => m.P_60YMAS, f: fmt },
    P_0A2: { nom: 'Bebés de 0 a 2 años', v: (m) => m.P_0A2, f: fmt },
    PCON_DISC: { nom: 'Personas con discapacidad', v: (m) => m.PCON_DISC, f: fmt },
  };
  function pintarMunicipios(r) {
    const e = r.estatal;
    const altos = e.porNivel.alto + e.porNivel.muy_alto;
    $('#mKpis').innerHTML = `
      <div><b>${fmt(r.municipios.length)}</b><small>municipios con datos</small></div>
      <div><b>${fmt(e.poblacion)}</b><small>habitantes</small></div>
      <div><b>${pct(altos, e.poblacion).toFixed(1)}%</b><small>en riesgo alto o muy alto (${fmt(altos)})</small></div>
      <div><b>${fmt(e.P_0A2)}</b><small>bebés de 0 a 2 años</small></div>
      <div><b>${fmt(e.P_60YMAS)}</b><small>personas de 60 y más</small></div>
      <div><b>${fmt(e.PCON_DISC)}</b><small>personas con discapacidad</small></div>`;
    $('#mNiveles').innerHTML = barraNiveles(e.porNivel);
    tablaMunicipios();
    capas.mun.clearLayers();
    const maxPob = Math.max(1, ...r.municipios.map((m) => m.poblacion));
    for (const m of r.municipios) {
      L.circleMarker([m.lat, m.lon], { radius: 4 + 18 * Math.sqrt(m.poblacion / maxPob), weight: 1, color: '#1b1b1b', fillColor: COLOR[m.nivel || 'sin_dato'], fillOpacity: 0.75 })
        .bindTooltip(`${esc(m.nombre)} · ${fmt(m.poblacion)} hab. · ${fmt(m.pctRiesgoAlto, 1)}% en riesgo alto`)
        .on('click', () => abrirFicha(m.mun))
        .addTo(capas.mun);
    }
  }
  function tablaMunicipios() {
    const r = st.resumen[claveEsc()];
    if (!r) return;
    const orden = $('#mOrden').value;
    const met = METRICAS[orden];
    const q = $('#mBuscar').value.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    const lista = r.municipios
      .filter((m) => !q || m.nombre.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').includes(q))
      .sort((a, b) => (met.v(b) ?? -1) - (met.v(a) ?? -1));
    const top = lista.slice(0, 10);
    const max = met.max || Math.max(1, ...top.map((m) => met.v(m) || 0));
    $('#mTopTitulo').textContent = `Los 10 primeros por ${met.nom.toLowerCase()}`;
    $('#mTop').innerHTML = top.map((m) => `<button type="button" class="b" data-mun="${esc(m.mun)}"><span>${esc(m.nombre)}</span><span class="v">${met.f(met.v(m))}</span><span class="t"><i style="width:${pct(met.v(m) || 0, max)}%;background:${COLOR[m.nivel || 'sin_dato']}"></i></span></button>`).join('');
    $('#mTabla tbody').innerHTML = lista.map((m) => `<tr class="clic" data-mun="${esc(m.mun)}" tabindex="0"><td data-l="Municipio">${esc(m.nombre)}</td><td class="n" data-l="Población">${fmt(m.poblacion)}</td><td class="n" data-l="% alto">${fmt(m.pctRiesgoAlto, 1)}%</td><td class="n" data-l="Vuln.">${m.vulnerabilidad ?? '–'}</td><td class="n" data-l="60+">${fmt(m.P_60YMAS)}</td><td data-l="Riesgo">${etiquetaNivel(m.nivel)}</td></tr>`).join('');
  }
  $('#mOrden').addEventListener('change', tablaMunicipios);
  $('#mBuscar').addEventListener('input', tablaMunicipios);
  $('#munLista').addEventListener('click', (ev) => { const m = ev.target.closest('[data-mun]'); if (m) abrirFicha(m.dataset.mun); });
  $('#mTabla').addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { const m = ev.target.closest('[data-mun]'); if (m) abrirFicha(m.dataset.mun); } });
  $('#mVolver').onclick = () => { $('#munFicha').hidden = true; $('#munLista').hidden = false; capas.geo.clearLayers(); dibujarGeocerca(st.geocerca, false); };

  async function abrirFicha(mun) {
    const e = escenario();
    $('#munLista').hidden = true; $('#munFicha').hidden = false;
    $('#fichaCont').innerHTML = '<p class="nota">Cargando…</p>';
    $('#panel').scrollTop = 0;
    try {
      const f = await api(`/api/municipio/${encodeURIComponent(mun)}?fenomeno=${e.fenomeno}&mes=${e.mes}`);
      const m = f.municipio;
      const t = f.agregados.total;
      const s = f.sismos;
      const gr = s?.gutenbergRichter;
      const mesI = e.mes - 1;
      const clima = f.climatologia ? `<h2>Clima típico (lluvia mensual, mm)</h2>${columnas(f.climatologia.meses, (x) => x.precip, mesI)}<div class="ejes">${MESES.map((x) => `<span>${x[0]}</span>`).join('')}</div>
        <p class="nota">${MESES[mesI]}: ${fmt(f.climatologia.meses[mesI].precip)} mm de lluvia y ${fmt(f.climatologia.meses[mesI].heladas, 1)} días con helada en promedio.</p>` : '';
      $('#fichaCont').innerHTML = `
        <h1>${esc(m.nombre)}</h1>
        <p>${etiquetaNivel(m.nivel)} <span class="nota">Lugar ${f.lugarEstatal.porRiesgo} de ${f.lugarEstatal.total} por riesgo · ${esc(st.meta.fenomenos[e.fenomeno].nombre)}</span></p>
        <div class="kpis k3">
          <div><b>${fmt(m.poblacion)}</b><small>habitantes en ${fmt(m.localidades)} localidades</small></div>
          <div><b>${fmt(m.pctRiesgoAlto, 1)}%</b><small>en riesgo alto o muy alto</small></div>
          <div><b>${m.vulnerabilidad ?? '–'}</b><small>vulnerabilidad promedio (0–1)</small></div>
          <div><b>${m.riesgo ?? '–'}</b><small>índice de riesgo promedio (0–1)</small></div>
          <div><b>${s ? fmt(s.total) : '–'}</b><small>sismos M≥4.5 a 50 km desde 1980</small></div>
          <div><b>${gr?.suficiente ? `${fmt(gr.periodoRetornoAnios.m6, 1)} años` : '–'}</b><small>periodo de retorno estimado de un M≥6 cercano</small></div>
        </div>
        <h2>Por nivel de riesgo</h2>${barraNiveles(f.porNivel)}
        <h2>Grupos vulnerables</h2><div class="barras">${htmlGrupos(t)}</div>
        <h2>Viviendas</h2><div class="barras">${htmlViv(t)}</div>
        <p class="nota">${esc(textoReservado(f.agregados.poblacionConDatoReservado))}</p>
        ${clima}
        <h2>Localidades prioritarias</h2>
        <div class="scroll"><table class="stack"><thead><tr><th>Localidad</th><th>Municipio</th><th class="n">Población</th><th class="n">0–2 / 60+</th><th>Riesgo</th></tr></thead><tbody>${filasLocalidades(f.localidades, 40)}</tbody></table></div>
        <div class="fila">
          <button type="button" id="fContar">Contar población aquí</button>
          <button type="button" id="fAlb" class="primario">Proponer albergues para este municipio</button>
        </div>`;
      capas.geo.clearLayers();
      const c = L.circle(f.area.centro, { radius: f.area.radioKm * 1000, color: '#0e5a7a', weight: 2, fillOpacity: 0.05, dashArray: '6 4' }).addTo(capas.geo);
      mapa.fitBounds(c.getBounds(), { padding: [20, 20], maxZoom: 12 });
      $('#fContar').onclick = () => { $('#fMun').value = mun; irA('contar'); const g = { tipo: 'circulo', centro: f.area.centro, radioKm: f.area.radioKm }; dibujarGeocerca(g); calcular(g); cargarLocalidades(); };
      $('#fAlb').onclick = () => { $('#aMun').value = mun; irA('albergues'); proponerAlbergues(); };
    } catch (err) { $('#fichaCont').innerHTML = `<p class="nota">${esc(err.message)}</p>`; }
  }

  // ---------- Albergues sugeridos ----------
  async function proponerAlbergues(ev) {
    if (ev) ev.preventDefault();
    const fd = new FormData($('#formAlb'));
    const e = escenario();
    const cuerpo = {
      ...e,
      k: Number(fd.get('k')), radioKm: Number(fd.get('radioKm')), pobMinCandidato: Number(fd.get('pobMinCandidato')),
      porcentajeAlbergue: Number(fd.get('porcentajeAlbergue')), mun: fd.get('mun') || null, niveles: fd.getAll('niv'),
    };
    $('#aRes').innerHTML = '<p class="nota">Calculando…</p>';
    try {
      const r = await postJSON('/api/albergues/sugerir', cuerpo);
      pintarAlbergues(r);
    } catch (err) { $('#aRes').innerHTML = `<p class="nota">${esc(err.message)}</p>`; }
  }
  $('#formAlb').addEventListener('submit', proponerAlbergues);

  function pintarAlbergues(r) {
    capas.alb.clearLayers();
    const s = r.resumen;
    if (!r.sitios.length) {
      $('#aRes').innerHTML = `<div class="vacio">No se encontraron sedes. ${s.demandaLocalidades ? `Hay ${fmt(s.demandaPoblacion)} personas en riesgo, pero ${s.candidatas ? 'ninguna sede alcanza' : 'no hay localidades candidatas fuera de peligro con esos habitantes mínimos'}.` : 'No hay población en los niveles de riesgo elegidos con este escenario.'} Prueba con otra distancia, menos habitantes mínimos u otro nivel.</div>`;
      return;
    }
    const grupo = [];
    r.sitios.forEach((x) => {
      const cob = L.circle([x.lat, x.lon], { radius: r.parametros.radioKm * 1000, color: '#2f8f5b', weight: 1, fillOpacity: 0.05 }).addTo(capas.alb);
      grupo.push(cob);
      for (const a of x.atiende) L.polyline([[x.lat, x.lon], [a.lat, a.lon]], { color: '#2f8f5b', weight: 1, opacity: 0.5 }).addTo(capas.alb);
      L.marker([x.lat, x.lon], { icon: L.divIcon({ className: 'numIcono', html: `<b>${x.orden}</b>`, iconSize: [24, 24], iconAnchor: [12, 12] }) })
        .bindPopup(`<strong>${x.orden}. ${esc(x.nom)}</strong><br>${esc(x.nomMun)}<br>Cubre ${fmt(x.cubre.poblacion)} personas en riesgo`)
        .addTo(capas.alb);
    });
    for (const n of r.sinCubrir) L.circleMarker([n.lat, n.lon], { radius: 5, color: '#c3262f', weight: 2, fill: false }).bindTooltip(`Sin cubrir: ${esc(n.nom)} (${fmt(n.poblacion)})`).addTo(capas.alb);
    if (grupo.length) mapa.fitBounds(L.featureGroup(grupo).getBounds(), { padding: [20, 20] });
    $('#aRes').innerHTML = `
      <div class="kpis">
        <div><b>${fmt(s.demandaPoblacion)}</b><small>personas en riesgo (${fmt(s.demandaLocalidades)} localidades)</small></div>
        <div><b>${fmt(s.porcentaje, 1)}%</b><small>quedan a ${r.parametros.radioKm} km o menos de un albergue (${fmt(s.cubierta)})</small></div>
        <div><b>${fmt(r.sitios.length)}</b><small>albergues propuestos de ${fmt(s.candidatas)} sedes posibles</small></div>
        <div><b>${fmt(s.capacidadTotal)}</b><small>lugares en total si el ${r.parametros.porcentajeAlbergue}% usa albergue</small></div>
      </div>
      ${s.porcentaje < 80 ? `<p class="nota">Para cubrir a más gente: aumenta la distancia máxima o el número de albergues, o baja los habitantes mínimos de la sede. Las sedes deben quedar fuera de la zona de peligro, así que las localidades más cercanas al peligro suelen quedar lejos.</p>` : ''}
      ${r.sitios.map((x) => `
        <div class="sitio">
          <h3><span class="num">${x.orden}</span>${esc(x.nom)}</h3>
          <p class="nota">${esc(x.nomMun)} · ${fmt(x.poblacionLocal)} habitantes · peligro en la sede ${x.peligroLocal}</p>
          <p>Cubre <b>${fmt(x.cubre.poblacion)}</b> personas en ${fmt(x.cubre.localidades)} localidades: ${fmt(x.cubre.P_0A2)} bebés, ${fmt(x.cubre.P_60YMAS)} adultos mayores, ${fmt(x.cubre.PCON_DISC)} con discapacidad. Distancia media ${x.distanciaMediaKm} km (máx. ${x.distanciaMaxKm} km). <b>Capacidad sugerida: ${fmt(x.capacidadSugerida)} personas.</b></p>
          <div class="fila"><button type="button" data-ver="${x.orden}">Ver en el mapa</button><button type="button" data-registrar="${x.orden}">Registrar como albergue</button></div>
        </div>`).join('')}
      ${r.sinCubrir.length ? `<h2>Localidades en riesgo sin cubrir (las más grandes)</h2><ul class="lista">${r.sinCubrir.slice(0, 10).map((n) => `<li><span>${esc(n.nom)} · ${esc(n.nomMun)}</span><span class="n">${fmt(n.poblacion)}</span></li>`).join('')}</ul>` : ''}
      <p class="nota">Propuesta para discutir con Protección Civil: hay que verificar el inmueble (escuela, deportivo), su estado estructural, servicios y accesos.</p>`;
    $('#aRes').onclick = async (ev) => {
      const ver = ev.target.closest('[data-ver]');
      const reg = ev.target.closest('[data-registrar]');
      const x = r.sitios.find((y) => String(y.orden) === (ver || reg)?.dataset[ver ? 'ver' : 'registrar']);
      if (!x) return;
      if (ver) mapa.setView([x.lat, x.lon], 11);
      if (reg) {
        try {
          await postJSON('/api/confirmaciones', { tipo: 'albergue', fuente: 'web', nombre: `Albergue propuesto ${x.nom}`, lat: x.lat, lon: x.lon, personas: 0, capacidad: x.capacidadSugerida, nota: `Propuesto por NEXO (${r.fenomeno})` });
          reg.textContent = 'Registrado ✓'; reg.disabled = true;
          cargarConfirmaciones();
        } catch (err) { reg.textContent = err.message; }
      }
    };
  }

  // ---------- Operación ----------
  function pintarOperacion(r) {
    if (!r) {
      ['#oExp', '#oConf', '#oSin'].forEach((s) => { $(s).textContent = '–'; });
      $('#oBarra').style.width = '0';
      $('#oNec').textContent = 'Dibuja una zona en “Contar población” para ver estas cifras.';
      return;
    }
    const o = r.operacion;
    $('#oExp').textContent = fmt(o.expuestos);
    $('#oConf').textContent = fmt(o.confirmados);
    $('#oSin').textContent = fmt(o.sinConfirmar);
    $('#oBarra').style.width = `${Math.min(100, pct(o.confirmados, o.expuestos))}%`;
    const nec = Object.entries(o.necesidades).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${NOM_NEC[k] || k} (${n})`);
    $('#oNec').textContent = o.puntos ? `${o.puntos} albergues o reportes dentro de la zona. Necesidades: ${nec.join(', ') || 'ninguna'}.` : 'Aún no hay albergues ni reportes dentro de la zona.';
  }
  async function cargarConfirmaciones() {
    st.conf = await api('/api/confirmaciones').catch(() => []);
    capas.conf.clearLayers();
    for (const c of st.conf) {
      L.circleMarker([c.lat, c.lon], { radius: 8, weight: 3, color: '#fff', fillColor: COLOR_TIPO[c.tipo] || '#555', fillOpacity: 1 })
        .bindPopup(`<strong>${esc(c.nombre)}</strong><br>${NOM_TIPO[c.tipo] || ''} · ${esc(c.fuente)}<br>${c.tipo === 'base' ? '' : `${fmt(c.personas)} personas${c.capacidad ? ` de ${fmt(c.capacidad)}` : ''}<br>`}${esc(c.necesidades.map((n) => NOM_NEC[n] || n).join(', '))}`)
        .addTo(capas.conf);
    }
    listaConfirmaciones();
    $('#rtBases').innerHTML = `<option value="">—</option>${st.conf.filter((c) => c.tipo === 'base').map((c) => `<option value="${esc(c.id)}">${esc(c.nombre)}</option>`).join('')}`;
  }
  function listaConfirmaciones() {
    const lista = st.conf.filter((c) => st.filtroConf === 'todos' || c.tipo === st.filtroConf).slice().reverse();
    $('#listaConf').innerHTML = lista.length
      ? lista.map((c) => `<li><span><span class="etq" style="border-color:${COLOR_TIPO[c.tipo]}">${NOM_TIPO[c.tipo] || ''}</span><strong>${esc(c.nombre)}</strong>${c.tipo === 'base' ? '' : ` · ${fmt(c.personas)} personas${c.capacidad ? ` / ${fmt(c.capacidad)}` : ''}`} · ${esc(c.fuente)}<br><small class="nota">${esc(new Date(c.fecha).toLocaleString('es-MX'))}${c.nota ? ` · ${esc(c.nota)}` : ''}</small></span><button type="button" data-borrar="${esc(c.id)}">Quitar</button></li>`).join('')
      : '<li class="nota">Sin registros.</li>';
  }
  $$('[data-filtro]').forEach((b) => b.addEventListener('click', () => {
    st.filtroConf = b.dataset.filtro;
    $$('[data-filtro]').forEach((x) => x.classList.toggle('activo', x === b));
    listaConfirmaciones();
  }));
  $('#listaConf').addEventListener('click', async (ev) => {
    const id = ev.target.closest('[data-borrar]')?.dataset.borrar;
    if (!id) return;
    await api(`/api/confirmaciones/${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => null);
    await cargarConfirmaciones();
    calcular();
  });
  $('#formConf').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const fd = new FormData(ev.target);
    const cuerpo = Object.fromEntries(fd.entries());
    cuerpo.necesidades = fd.getAll('nec');
    try {
      await postJSON('/api/confirmaciones', cuerpo);
      $('#formMsg').textContent = 'Guardado.';
      ev.target.reset();
      await cargarConfirmaciones();
      calcular();
    } catch (err) { $('#formMsg').textContent = err.message; }
  });
  $('#btnUbicar').addEventListener('click', () => { st.ubicando = true; pista('Da clic en el mapa para fijar la ubicación del punto'); });

  // ---------- Rutas ----------
  const txtPunto = (p) => (p ? `${esc(p.nombre || 'Punto en el mapa')} (${p.lat.toFixed(4)}, ${p.lon.toFixed(4)})` : 'Sin elegir.');
  function pintarPuntosRuta() {
    $('#rtDestinoTxt').innerHTML = txtPunto(st.ruta.destino);
    $('#rtOrigenTxt').innerHTML = txtPunto(st.ruta.origen);
    capas.ruta.clearLayers();
    if (st.ruta.origen) L.circleMarker([st.ruta.origen.lat, st.ruta.origen.lon], { radius: 9, weight: 3, color: '#fff', fillColor: '#1f5fbf', fillOpacity: 1 }).bindTooltip('Origen').addTo(capas.ruta);
    if (st.ruta.destino) L.circleMarker([st.ruta.destino.lat, st.ruta.destino.lon], { radius: 9, weight: 3, color: '#fff', fillColor: '#c3262f', fillOpacity: 1 }).bindTooltip('Emergencia').addTo(capas.ruta);
  }
  $('#rtMarcarDestino').onclick = () => { st.rutaMarcando = 'destino'; pista('Da clic en el mapa donde está la emergencia'); };
  $('#rtMarcarOrigen').onclick = () => { st.rutaMarcando = 'origen'; pista('Da clic en el mapa de donde sale la ayuda'); };
  $('#rtBases').onchange = () => {
    const c = st.conf.find((x) => x.id === $('#rtBases').value);
    if (c) { st.ruta.origen = { lat: c.lat, lon: c.lon, nombre: c.nombre }; pintarPuntosRuta(); }
  };
  async function masCercano(tipo, desde) {
    const lista = await api(`/api/cercano?lat=${desde.lat}&lon=${desde.lon}&tipo=${tipo}`);
    return lista[0] || null;
  }
  $('#rtBaseCercana').onclick = async () => {
    if (!st.ruta.destino) { $('#rtRes').innerHTML = '<p class="nota">Primero marca la emergencia.</p>'; return; }
    const b = await masCercano('base', st.ruta.destino).catch(() => null);
    if (!b) { $('#rtRes').innerHTML = '<p class="nota">No hay bases registradas. Agrégalas en “Operación” con tipo “Base de respuesta”.</p>'; return; }
    st.ruta.origen = { lat: b.lat, lon: b.lon, nombre: `${b.nombre} (a ${b.distanciaKm} km en línea recta)` };
    pintarPuntosRuta();
  };
  async function trazar(origen, destino, titulo) {
    $('#rtRes').innerHTML = '<p class="nota">Calculando ruta…</p>';
    try {
      const r = await api(`/api/ruta?origen=${origen.lat},${origen.lon}&destino=${destino.lat},${destino.lon}`);
      pintarPuntosRuta();
      const linea = L.polyline(r.geometria, { color: r.estimada ? '#555' : '#1f5fbf', weight: 5, opacity: 0.85, dashArray: r.estimada ? '8 8' : null }).addTo(capas.ruta);
      mapa.fitBounds(linea.getBounds(), { padding: [40, 40] });
      const gmaps = `https://www.google.com/maps/dir/?api=1&origin=${origen.lat},${origen.lon}&destination=${destino.lat},${destino.lon}&travelmode=driving`;
      $('#rtRes').innerHTML = `
        <h2>${esc(titulo)}</h2>
        <div class="kpis"><div><b>${fmt(r.distanciaKm, 1)} km</b><small>distancia${r.estimada ? ' estimada' : ''}</small></div><div><b>${fmt(r.duracionMin)} min</b><small>tiempo${r.estimada ? ' estimado a 40 km/h' : ' de manejo'}</small></div></div>
        <p class="nota">Calculada con: ${esc(r.proveedor)}.${r.avisos?.length ? ` (${esc(r.avisos.join(' · '))})` : ''}</p>
        <p><a href="${esc(gmaps)}" target="_blank" rel="noopener">Abrir esta ruta en Google Maps (para el celular de la unidad)</a></p>
        <p class="nota">La ruta no sabe qué vías cerró el desastre: confirmen con las brigadas.</p>`;
    } catch (err) { $('#rtRes').innerHTML = `<p class="nota">${esc(err.message)}</p>`; }
  }
  $('#rtCalcular').onclick = () => {
    if (!st.ruta.destino || !st.ruta.origen) { $('#rtRes').innerHTML = '<p class="nota">Marca la emergencia y elige el origen.</p>'; return; }
    trazar(st.ruta.origen, st.ruta.destino, 'Ruta de la ayuda a la emergencia');
  };
  $('#rtAlbergue').onclick = async () => {
    if (!st.ruta.destino) { $('#rtRes').innerHTML = '<p class="nota">Primero marca la emergencia (el lugar de donde hay que evacuar).</p>'; return; }
    const a = await masCercano('albergue', st.ruta.destino).catch(() => null);
    if (!a) { $('#rtRes').innerHTML = '<p class="nota">No hay albergues registrados todavía.</p>'; return; }
    trazar(st.ruta.destino, { lat: a.lat, lon: a.lon }, `Evacuar a ${a.nombre}${a.capacidad ? ` (${fmt(a.personas)} de ${fmt(a.capacidad)} lugares ocupados)` : ''}`);
  };

  // ---------- Sismos y clima ----------
  const puntoAnalisis = () => st.punto || centro(st.geocerca) || [19.04, -98.2];
  function textoCentro() {
    const p = puntoAnalisis();
    const origen = st.punto ? 'punto elegido en el mapa' : st.geocerca ? 'centro de tu zona' : 'ciudad de Puebla (da clic en el mapa para cambiarlo)';
    const t = `Centro: ${p[0].toFixed(4)}, ${p[1].toFixed(4)} · ${origen}`;
    $('#sCentro').textContent = t; $('#cCentro').textContent = t;
  }
  function columnas(datos, valor, sel) {
    const max = Math.max(1, ...datos.map(valor));
    return `<div class="cols">${datos.map((d, i) => `<div class="${sel === i ? 'sel' : ''}"><i style="height:${(100 * valor(d)) / max}%"></i></div>`).join('')}</div>`;
  }
  async function analizarSismos() {
    const c = puntoAnalisis();
    const radio = Number($('#sRadio').value) || 100;
    const mag = Number($('#sMag').value) || 4.5;
    $('#sRes').innerHTML = '<p class="nota">Calculando…</p>';
    try {
      const r = await api(`/api/sismos?lat=${c[0]}&lon=${c[1]}&radioKm=${radio}&magMin=${mag}`);
      const gr = r.gutenbergRichter;
      capas.sis.clearLayers();
      for (const [la, lo, m, f] of r.eventos) L.circleMarker([la, lo], { radius: Math.max(2, (m - 4) * 3), color: '#5a2ca0', weight: 1, fillOpacity: 0.35 }).bindTooltip(`M${m} · ${f}`).addTo(capas.sis);
      L.circle(c, { radius: radio * 1000, color: '#5a2ca0', weight: 1, fill: false, dashArray: '4 4' }).addTo(capas.sis);
      const anios = r.porAnio;
      $('#sRes').innerHTML = `
        <div class="kpis">
          <div><b>${fmt(r.total)}</b><small>sismos M≥${mag} a ${radio} km desde ${esc((r.desde || '').slice(0, 4))}</small></div>
          <div><b>${r.maxima ? `M${r.maxima.mag}` : '–'}</b><small>${r.maxima ? esc(`${r.maxima.fecha.slice(0, 10)} · ${r.maxima.lugar || ''}`) : 'sin eventos'}</small></div>
          <div><b>${gr.suficiente ? `${gr.b} ± ${gr.errorB}` : '–'}</b><small>valor b (Gutenberg-Richter)</small></div>
          <div><b>${gr.suficiente ? `${fmt(gr.periodoRetornoAnios.m6, 1)} años` : '–'}</b><small>periodo de retorno estimado de un M≥6</small></div>
        </div>
        ${gr.suficiente ? `<p class="nota">Se esperan en promedio ${gr.tasaAnual.m5} sismos M≥5 por año en esta zona. Es frecuencia histórica, no predicción.</p>` : '<p class="nota">Menos de 20 sismos: no alcanza para estimar el valor b. Amplía el radio.</p>'}
        <h2>Sismos por año</h2>
        ${anios.length ? `${columnas(anios, (d) => d.n)}<div class="ejes"><span>${anios[0].anio}</span><span>${anios[anios.length - 1].anio}</span></div>` : '<p class="nota">Sin datos.</p>'}
        <h2>Por magnitud</h2>
        <div class="barras">${r.histograma.map((h) => barra(`M ${h.desde.toFixed(1)}–${(h.desde + 0.4).toFixed(1)}`, h.n, r.total)).join('')}</div>
        <h2>Más recientes</h2>
        <div class="scroll"><table><thead><tr><th>Fecha</th><th class="n">M</th><th class="n">Prof. km</th><th>Lugar</th></tr></thead><tbody>
        ${r.recientes.map((x) => `<tr><td>${esc(x.fecha.slice(0, 10))}</td><td class="n">${esc(x.mag)}</td><td class="n">${esc(Math.round(x.prof))}</td><td>${esc(x.lugar)}</td></tr>`).join('')}
        </tbody></table></div>
        <p class="nota">Fuente: ${esc(r.fuente)}.</p>`;
    } catch (err) { $('#sRes').innerHTML = `<p class="nota">${esc(err.message)}</p>`; }
  }
  async function consultarClima() {
    const c = puntoAnalisis();
    $('#cRes').innerHTML = '<p class="nota">Consultando…</p>';
    try {
      const r = await api(`/api/clima?lat=${c[0]}&lon=${c[1]}`);
      const mes = Number($('#fMes').value) - 1;
      let html = '';
      if (r.pronostico?.diario?.time) {
        const d = r.pronostico.diario;
        html += `<h2>Pronóstico de 7 días</h2><div class="scroll"><table><thead><tr><th>Día</th><th class="n">Lluvia mm</th><th class="n">Prob. %</th><th class="n">Mín/Máx °C</th><th class="n">Viento km/h</th></tr></thead><tbody>${d.time.map((t, i) => `<tr><td>${esc(t)}</td><td class="n">${fmt(d.precipitation_sum?.[i], 1)}</td><td class="n">${fmt(d.precipitation_probability_max?.[i])}</td><td class="n">${fmt(d.temperature_2m_min?.[i], 1)} / ${fmt(d.temperature_2m_max?.[i], 1)}</td><td class="n">${fmt(d.wind_speed_10m_max?.[i])}</td></tr>`).join('')}</tbody></table></div>`;
      } else html += `<p class="nota">Pronóstico no disponible: ${esc(r.errorPronostico || 'sin conexión')}</p>`;
      if (r.climatologia) {
        const m = r.climatologia.meses;
        const ejes = `<div class="ejes">${MESES.map((x) => `<span>${x[0]}</span>`).join('')}</div>`;
        html += `<h2>Lluvia promedio por mes (mm)</h2>${columnas(m, (x) => x.precip, mes)}${ejes}
          <h2>Días con helada por mes</h2>${columnas(m, (x) => x.heladas, mes)}${ejes}
          <p class="nota">Periodo ${esc(r.periodo)} · ${esc(MESES[mes])}: ${fmt(m[mes].precip)} mm y ${fmt(m[mes].heladas, 1)} días con helada en promedio.</p>`;
      } else html += '<p class="nota">Sin climatología descargada todavía.</p>';
      $('#cRes').innerHTML = html;
    } catch (err) { $('#cRes').innerHTML = `<p class="nota">${esc(err.message)}</p>`; }
  }
  $('#btnSismos').onclick = analizarSismos;
  $('#btnClima').onclick = consultarClima;

  // ---------- Clic en el mapa según la herramienta ----------
  mapa.on('click', (ev) => {
    const p = [Number(ev.latlng.lat.toFixed(5)), Number(ev.latlng.lng.toFixed(5))];
    if (st.ubicando) {
      st.ubicando = false;
      $('#formConf').elements.lat.value = p[0];
      $('#formConf').elements.lon.value = p[1];
      $('#formMsg').textContent = 'Ubicación fijada.';
      pista('');
      return;
    }
    if (st.sec === 'contar') {
      if (st.modo === 'circulo') {
        const g = { tipo: 'circulo', centro: p, radioKm: Number($('#radio').value) };
        dibujarGeocerca(g, false); calcular(g);
      } else { st.vertices.push(p); pintarVertices(); }
    } else if (st.sec === 'rutas' && st.rutaMarcando) {
      st.ruta[st.rutaMarcando] = { lat: p[0], lon: p[1], nombre: st.rutaMarcando === 'destino' ? 'Emergencia' : 'Punto de salida' };
      st.rutaMarcando = null;
      pista('');
      pintarPuntosRuta();
    } else if (st.sec === 'sismos' || st.sec === 'clima') {
      st.punto = p;
      capas.punto.clearLayers();
      L.circleMarker(p, { radius: 7, weight: 3, color: '#fff', fillColor: '#5a2ca0', fillOpacity: 1 }).addTo(capas.punto);
      textoCentro();
    }
  });

  // ---------- Escenario ----------
  async function recargarEscenario() {
    notaMes();
    await cargarLocalidades();
    await calcular();
    if (st.sec === 'riesgo' || st.sec === 'inicio') cargarResumen().then(pintarRiesgo).catch(() => {});
    if (st.sec === 'municipios') { $('#mVolver').click(); cargarResumen().then(pintarMunicipios).catch(() => {}); }
    if ($('#aRes').innerHTML) { $('#aRes').innerHTML = '<p class="nota">Cambió el escenario: presiona “Proponer ubicaciones” de nuevo.</p>'; capas.alb.clearLayers(); }
  }
  ['#fFenomeno', '#fMes'].forEach((s) => $(s).addEventListener('change', recargarEscenario));
  ['#fMun', '#fPobMin'].forEach((s) => $(s).addEventListener('change', () => { cargarLocalidades(); calcular(); }));
  $('#fNiveles').addEventListener('change', () => { cargarLocalidades(); calcular(); });
  ['#capaPopo', '#capaPuntos'].forEach((s) => $(s).addEventListener('change', () => mostrarCapas(st.sec)));
  $('#btnRecargar').onclick = async () => { await postJSON('/api/recargar', {}).catch(() => null); await iniciar(); };

  // ---------- Inicio ----------
  async function iniciar() {
    try {
      const e = await api('/api/estado');
      const primera = !st.meta;
      st.meta = e;
      if (primera) montarFiltros(e);
      pintarEstado(e);
      const v = e.volcanes?.[0];
      capas.popo.clearLayers();
      if (v) L.circle([v.lat, v.lon], { radius: v.radioRestriccionKm * 1000, color: '#c3262f', weight: 2, fill: false, dashArray: '6 6' }).bindTooltip(`${v.nombre}: radio de ${v.radioRestriccionKm} km`).addTo(capas.popo);
      if (e.trabajos.sismos === 'descargando' || e.trabajos.clima === 'descargando') vigilar();
      await cargarMunicipiosLista();
      await cargarLocalidades();
      await cargarConfirmaciones();
      irA(location.hash.slice(1) || 'inicio');
    } catch (err) {
      $('#estadoDatos').innerHTML = `<span class="chip mal">Servidor no disponible: ${esc(err.message)}</span>`;
    }
  }
  iniciar();
})();
