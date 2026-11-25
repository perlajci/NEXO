// NEXO v0.2 · interfaz por secciones. Todo texto que viene de datos se escapa antes de insertarse.
(() => {
  'use strict';
  // ---------- Sesión ----------
  // Si la sesión vence mientras se usa PIANI, el servidor responde 401 con X-Piani-Sesion: requerida.
  // Cualquier petición que lo reciba manda al login y, al entrar, regresa a la misma sección.
  const irAlLogin = () => location.replace(`/login.html?siguiente=${encodeURIComponent(location.pathname + location.hash)}`);
  const fetchOriginal = window.fetch.bind(window);
  window.fetch = async (...args) => {
    const r = await fetchOriginal(...args);
    if (r.status === 401 && r.headers.get('X-Piani-Sesion') === 'requerida') irAlLogin();
    return r;
  };
  fetchOriginal('/api/sesion', { cache: 'no-store' }).then((r) => r.json()).then((s) => {
    if (!s.requerida) return; // login apagado (sin PIANI_CLAVE): no hay nada que cerrar
    const b = document.querySelector('#btnSalir');
    b.hidden = false;
    b.addEventListener('click', async () => {
      b.disabled = true;
      await fetchOriginal('/api/sesion/salir', { method: 'POST' }).catch(() => {});
      location.replace('/login.html');
    });
  }).catch(() => {});

  // ---------- Utilidades ----------
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (n, d = 0) => (n === null || n === undefined || !Number.isFinite(Number(n)) ? '–' : Number(n).toLocaleString('es-MX', { maximumFractionDigits: d }));
  const pct = (a, b) => (b > 0 && Number.isFinite(a) ? (100 * a) / b : 0);
  const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
  const COLOR = { bajo: '#3f9b6b', medio: '#e0ad2f', alto: '#e3742b', muy_alto: '#c3262f', sin_dato: '#9aa0a6' };
  const COBALTO = '#0b2a55'; // azul marino PIANI: zonas dibujadas por la persona usuaria
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
    repFiltro: 'todos', repConRiesgo: false,
  };
  let marcadoresConf = new Map();
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
    municipios: ['mun', 'geo'], albergues: ['loc', 'alb'], reportes: ['conf'], operacion: ['loc', 'geo', 'conf'],
    rutas: ['conf', 'ruta'], sismos: ['sis', 'punto', 'geo'], clima: ['punto', 'geo'], ayuda: ['loc'],
    tabulador: [],
  };
  function pintarLeyenda() {
    $('#leyenda').hidden = st.sec === 'tabulador'; // el tabulador no pinta nada en el mapa
    if (st.sec === 'reportes' && !st.repConRiesgo) {
      $('#leyenda').innerHTML = Object.entries(NOM_TIPO).map(([k, v]) => `<span><i style="background:${COLOR_TIPO[k]}"></i>${v}</span>`).join('');
    } else {
      $('#leyenda').innerHTML = NIV_ORDEN.map((n) => `<span><i style="background:${COLOR[n]}"></i>${NOM_NIV[n]}</span>`).join('');
    }
  }
  function mostrarCapas(sec) {
    const quiero = new Set(CAPAS_SEC[sec] || []);
    if (sec === 'reportes' && st.repConRiesgo) { quiero.add('loc'); quiero.add('popo'); }
    if (sec === 'riesgo' || sec === 'inicio') {
      if (!$('#capaPopo').checked) quiero.delete('popo');
      if (!$('#capaPuntos').checked) quiero.delete('conf');
    }
    for (const [k, c] of Object.entries(capas)) {
      if (quiero.has(k)) c.addTo(mapa); else mapa.removeLayer(c);
    }
    pintarLeyenda();
  }
  const pista = (txt) => { $('#pista').hidden = !txt; $('#pista').textContent = txt || ''; };

  // ---------- Navegación ----------
  const SECCIONES = ['inicio', 'riesgo', 'contar', 'municipios', 'albergues', 'reportes', 'operacion', 'tabulador', 'rutas', 'clima', 'ayuda'];
  function irA(sec) {
    if (!SECCIONES.includes(sec)) sec = 'inicio';
    st.sec = sec;
    $$('.riel button').forEach((b) => { const a = b.dataset.sec === sec; b.classList.toggle('activo', a); if (a) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
    $$('.sec').forEach((s) => { s.hidden = s.dataset.sec !== sec; });
    document.body.classList.toggle('ancho', sec === 'municipios' || sec === 'tabulador');
    st.ubicando = false; st.rutaMarcando = null;
    pista(sec === 'contar' && !st.geocerca ? 'Da clic en el mapa para poner el centro de la zona' : '');
    pintarMarcadoresConf();
    mostrarCapas(sec);
    $('#panel').scrollTop = 0;
    if (location.hash !== `#${sec}`) history.replaceState(null, '', `#${sec}`);
    setTimeout(() => mapa.invalidateSize && mapa.invalidateSize(), 50);
    if (sec === 'riesgo' || sec === 'inicio') cargarResumen().then(pintarRiesgo).catch(() => {});
    if (sec === 'municipios') cargarResumen().then(pintarMunicipios).catch(() => {});
    if (sec === 'reportes') { cargarConfirmaciones().then(() => { pintarReportes(); centrarReportes(); }); }
    if (sec === 'operacion' || sec === 'rutas') cargarConfirmaciones();
    if (sec === 'sismos' || sec === 'clima') textoCentro();
    if (sec === 'tabulador') { cargarTabulador(); cargarGuardados(); }
    if (sec === 'inicio') pintarInicioTab();
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
    if (!e.iter) {
      $('#iCifra').textContent = '–';
      $('#iFranja').innerHTML = '';
      $('#iEscenario').textContent = 'Falta cargar el censo del INEGI';
    }
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
    pintarLectura(e, altos, r.municipios.filter((m) => m.nivel === 'alto' || m.nivel === 'muy_alto').length);
  }

  // Lectura del escenario en Inicio: cuánta gente está en riesgo con el fenómeno y mes elegidos.
  function pintarLectura(e, altos, munAltos) {
    const fen = st.meta?.fenomenos?.[$('#fFenomeno').value];
    const mes = MESES[Number($('#fMes').value) - 1];
    $('#iEscenario').textContent = `${fen?.nombre || 'Sin escenario'}${fen?.estacional && mes ? `, ${mes.toLowerCase()}` : ''}`;
    $('#iCifra').textContent = fmt(altos);
    const tot = NIV_ORDEN.reduce((a, k) => a + (e.porNivel[k] || 0), 0) || 1;
    const niv = NIV_ORDEN.filter((k) => (e.porNivel[k] || 0) > 0);
    $('#iFranja').innerHTML = `<div class="apilada" role="img" aria-label="Población por nivel de riesgo">${niv.map((k) => `<i style="width:${pct(e.porNivel[k], tot)}%;background:${COLOR[k]}"></i>`).join('')}</div>
      <div class="claves">${niv.map((k) => `<span><i style="background:${COLOR[k]}"></i>${NOM_NIV[k]} ${pct(e.porNivel[k], tot).toFixed(1)} %</span>`).join('')}</div>`;
    $('#iPct').textContent = `${pct(altos, e.poblacion).toFixed(1)} %`;
    $('#iPob').textContent = Number(e.poblacion).toLocaleString('es-MX', { notation: 'compact', maximumFractionDigits: 2 });
    $('#iMun').textContent = fmt(munAltos);
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
    const estilo = { color: COBALTO, weight: 2.5, fillOpacity: 0.08, dashArray: '6 4' };
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
    st.vertices.forEach((v) => L.circleMarker(v, { radius: 4, color: COBALTO, fillOpacity: 1 }).addTo(capas.vert));
    if (st.vertices.length > 1) L.polyline(st.vertices, { color: COBALTO, dashArray: '4 4' }).addTo(capas.vert);
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
      const c = L.circle(f.area.centro, { radius: f.area.radioKm * 1000, color: COBALTO, weight: 2, fillOpacity: 0.05, dashArray: '6 4' }).addTo(capas.geo);
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
  function centrarReportes() {
    const pts = st.conf.map((c) => [c.lat, c.lon]);
    if (!pts.length) return;
    if (pts.length === 1) mapa.setView(pts[0], 13);
    else mapa.fitBounds(pts, { padding: [50, 50], maxZoom: 13 });
  }
  function pintarMarcadoresConf() {
    capas.conf.clearLayers();
    marcadoresConf = new Map();
    const enReportes = st.sec === 'reportes';
    const letra = { reporte: 'R', albergue: 'A', base: 'B' };
    for (const c of st.conf) {
      const color = COLOR_TIPO[c.tipo] || '#555';
      const popup = `<strong>${esc(c.nombre)}</strong><br>${NOM_TIPO[c.tipo] || ''} · ${c.fuente === 'lora' ? 'Red ESP32' : esc(c.fuente)}<br>${c.tipo === 'base' ? '' : `${fmt(c.personas)} personas${c.capacidad ? ` de ${fmt(c.capacidad)}` : ''}<br>`}${c.necesidades.length ? `Insumos: ${esc(c.necesidades.map((n) => NOM_NEC[n] || n).join(', '))}<br>` : ''}${c.nota ? `<small>${esc(c.nota)}</small>` : ''}`;
      const icono = L.divIcon({ className: 'pinRep', html: `<span style="background:${color}">${letra[c.tipo] || '•'}</span>`, iconSize: [28, 28], iconAnchor: [14, 14] });
      const m = L.marker([c.lat, c.lon], { icon: icono, zIndexOffset: 900 }).bindPopup(popup);
      if (enReportes) m.bindTooltip(esc(c.nombre), { permanent: true, direction: 'top', offset: [0, -14], className: 'etiqRep' });
      m.addTo(capas.conf);
      marcadoresConf.set(c.id, m);
    }
  }
  function pintarReportes() {
    const tot = st.conf.length;
    const esp = st.conf.filter((c) => c.fuente === 'lora').length;
    const pers = st.conf.filter((c) => c.tipo !== 'base').reduce((a, c) => a + (c.personas || 0), 0);
    const ult = st.conf.length ? new Date(st.conf[st.conf.length - 1].fecha).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' }) : '–';
    const badge = $('#badgeRep');
    if (badge) { badge.hidden = tot === 0; badge.textContent = String(tot); }
    const iRep = $('#iRepTxt');
    if (iRep) iRep.textContent = tot ? `${fmt(tot)} registros (${fmt(pers)} personas · ${fmt(esp)} vía ESP32)` : 'Aún no hay reportes recibidos';

    const kpis = $('#repKpis');
    if (kpis) {
      kpis.innerHTML = `
        <div><b>${fmt(tot)}</b><small>reportes y puntos activos</small></div>
        <div><b>${fmt(pers)}</b><small>personas reportadas</small></div>
        <div><b>${fmt(esp)}</b><small>recibidos por red ESP32</small></div>
        <div><b>${esc(ult)}</b><small>último reporte</small></div>`;
    }
    const conteoNec = {};
    for (const c of st.conf) for (const n of c.necesidades || []) conteoNec[n] = (conteoNec[n] || 0) + 1;
    const necOrden = Object.entries(conteoNec).sort((a, b) => b[1] - a[1]);
    const necEl = $('#repNec');
    if (necEl) necEl.innerHTML = necOrden.length ? necOrden.map(([k, n]) => `<span>${esc(NOM_NEC[k] || k)}: ${n}</span>`).join('') : '';

    const filtrados = st.conf.filter((c) => {
      if (st.repFiltro === 'todos') return true;
      if (st.repFiltro === 'lora') return c.fuente === 'lora';
      return c.tipo === st.repFiltro;
    }).slice().reverse();
    const cont = $('#listaReportes');
    if (!cont) return;
    cont.innerHTML = filtrados.length ? filtrados.map((c) => `
      <article class="rep-card ${esc(c.tipo)}">
        <div class="rep-top">
          <h3>${esc(c.nombre)}</h3>
          <span class="etq" style="border-color:${COLOR_TIPO[c.tipo]}">${NOM_TIPO[c.tipo] || ''}</span>
        </div>
        <div class="rep-meta">
          ${c.fuente === 'lora' ? '<span class="rep-badge esp">ESP32 · Sin internet</span>' : `<span class="rep-badge">${esc(c.fuente)}</span>`}
          ${c.tipo === 'base' ? '' : `<strong>${fmt(c.personas)} personas${c.capacidad ? ` / ${fmt(c.capacidad)}` : ''}</strong>`}
          <span class="nota">${esc(new Date(c.fecha).toLocaleString('es-MX'))}</span>
        </div>
        ${c.necesidades?.length ? `<div class="rep-chips">${c.necesidades.map((n) => `<span>${esc(NOM_NEC[n] || n)}</span>`).join('')}</div>` : ''}
        ${c.nota ? `<p class="nota">${esc(c.nota)}</p>` : ''}
        <div class="rep-acciones">
          <button type="button" class="primario" data-ver="${esc(c.id)}">Ver en mapa</button>
          <button type="button" data-ruta-rep="${esc(c.id)}">Trazar ruta</button>
          <button type="button" data-borrar-rep="${esc(c.id)}">Quitar</button>
        </div>
      </article>`).join('') : '<div class="vacio">No hay reportes en este filtro. Envía uno desde el celular conectado al ESP32 y aparecerá aquí al instante.</div>';
  }

  let ultimaFirmaConf = '';
  let avisoTimer = null;
  async function cargarConfirmaciones({ soloSiCambio = false } = {}) {
    const nueva = await api('/api/confirmaciones').catch(() => null);
    if (!nueva) return;
    const firma = JSON.stringify(nueva);
    if (soloSiCambio && firma === ultimaFirmaConf) return;
    const idsPrev = new Set(st.conf.map((x) => x.id));
    const entrante = soloSiCambio ? nueva.find((x) => !idsPrev.has(x.id)) || nueva[nueva.length - 1] : null;
    ultimaFirmaConf = firma;
    st.conf = nueva;
    pintarMarcadoresConf();
    listaConfirmaciones();
    pintarReportes();
    const selBase = $('#rtBases').value;
    $('#rtBases').innerHTML = `<option value="">—</option>${st.conf.filter((c) => c.tipo === 'base').map((c) => `<option value="${esc(c.id)}">${esc(c.nombre)}</option>`).join('')}`;
    if (selBase) $('#rtBases').value = selBase;
    if (soloSiCambio && st.geo) calcular();
    if (entrante) {
      pista(`Nuevo ${NOM_TIPO[entrante.tipo] || 'registro'} recibido: ${entrante.nombre} (${fmt(entrante.personas)} personas)`);
      if (avisoTimer) clearTimeout(avisoTimer);
      avisoTimer = setTimeout(() => pista(''), 8000);
      const m = marcadoresConf.get(entrante.id);
      if (m && mapa.hasLayer(capas.conf)) {
        mapa.panTo([entrante.lat, entrante.lon]);
        m.openPopup();
      }
    }
  }
  setInterval(() => cargarConfirmaciones({ soloSiCambio: true }), 3000);

  $('#repSolo').onclick = () => {
    st.repConRiesgo = false;
    $('#repSolo').classList.add('activo'); $('#repConRiesgo').classList.remove('activo');
    mostrarCapas('reportes');
  };
  $('#repConRiesgo').onclick = () => {
    st.repConRiesgo = true;
    $('#repConRiesgo').classList.add('activo'); $('#repSolo').classList.remove('activo');
    mostrarCapas('reportes');
  };
  $('#btnCentrarRep').onclick = () => centrarReportes();
  $$('[data-rep-filtro]').forEach((b) => b.addEventListener('click', () => {
    st.repFiltro = b.dataset.repFiltro;
    $$('[data-rep-filtro]').forEach((x) => x.classList.toggle('activo', x === b));
    pintarReportes();
  }));
  $('#listaReportes').addEventListener('click', async (ev) => {
    const verId = ev.target.closest('[data-ver]')?.dataset.ver;
    if (verId) {
      const c = st.conf.find((x) => x.id === verId);
      const m = marcadoresConf.get(verId);
      if (c) { mapa.setView([c.lat, c.lon], 13); if (m) m.openPopup(); }
      return;
    }
    const rutaId = ev.target.closest('[data-ruta-rep]')?.dataset.rutaRep;
    if (rutaId) {
      const c = st.conf.find((x) => x.id === rutaId);
      if (c) {
        st.ruta.destino = { lat: c.lat, lon: c.lon, nombre: c.nombre };
        irA('rutas');
        pintarPuntosRuta();
      }
      return;
    }
    const delId = ev.target.closest('[data-borrar-rep]')?.dataset.borrarRep;
    if (delId) {
      await api(`/api/confirmaciones/${encodeURIComponent(delId)}`, { method: 'DELETE' }).catch(() => null);
      await cargarConfirmaciones();
      if (st.geo) calcular();
    }
  });
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

  // ---------- Tabulador CAPCEE ----------
  // Catálogo de precios de referencia. Los datos vienen de data/capcee/tabulador.csv vía /api/tabulador.
  const TIPO_CLASE = { 'OFICIAL CAPCEE': 'oficial', 'REFERENCIA PÚBLICA': 'referencia', ESTIMADO: 'estimado' };
  const POR_PAGINA = 20;
  const tab = { conceptos: [], pagina: 0, pedido: 0 };
  const dos = (n) => Number(n).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const dinero = (n) => Number(n).toLocaleString('es-MX', { style: 'currency', currency: 'MXN', minimumFractionDigits: 2, maximumFractionDigits: 2 });
  // Los conceptos con unidad % guardan un porcentaje, no pesos.
  const precioTab = (c) => (c.unidad === '%' ? `${dos(c.precio)} %` : dinero(c.precio));
  const etiquetaTipo = (c) => {
    const fuente = c.fuente || 'Sin fuente registrada';
    return `<span class="tipo-dato ${TIPO_CLASE[c.tipo_dato] || ''}" tabindex="0" data-fuente="${esc(fuente)}" aria-label="${esc(`${c.tipo_dato}. Fuente: ${fuente}`)}">${esc(c.tipo_dato)}</span>`;
  };
  // A diferencia de api(), devuelve también el texto de ayuda del servidor para mostrarlo en el aviso.
  const apiTab = async (ruta) => {
    const r = await fetch(ruta);
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(j.error || `Error ${r.status}`), { ayuda: j.ayuda || '' });
    return j;
  };

  async function cargarTabulador() {
    const n = ++tab.pedido;
    const p = new URLSearchParams({ buscar: $('#tBuscar').value.trim(), capitulo: $('#tCapitulo').value, tipo: $('#tTipo').value });
    try {
      const [cat, res] = await Promise.all([apiTab(`/api/tabulador?${p}`), apiTab('/api/tabulador/resumen')]);
      if (n !== tab.pedido) return; // ya hay una búsqueda más reciente
      $('#tAviso').hidden = true;
      $('#tContenido').hidden = false;
      tab.conceptos = cat.conceptos;
      tab.pagina = 0;
      pintarKpisTab(res);
      pintarTablaTab();
      pintarRechazadosTab(cat.rechazados);
    } catch (e) {
      if (n !== tab.pedido) return;
      $('#tContenido').hidden = true;
      $('#tAviso').hidden = false;
      $('#tAviso').innerHTML = `<b>No se pudo cargar el tabulador.</b> ${esc(e.message)}${e.ayuda ? `<br>${esc(e.ayuda)}` : ''}`;
    }
  }

  // Tarjeta del tabulador en Inicio: cuántos conceptos hay de cada tipo de dato.
  async function pintarInicioTab() {
    const caja = $('#iTabTipos');
    try {
      const r = await apiTab('/api/tabulador/resumen');
      const NOMBRES = { 'OFICIAL CAPCEE': ['oficial del CAPCEE', 'oficiales del CAPCEE'], 'REFERENCIA PÚBLICA': ['de referencia pública', 'de referencia pública'], ESTIMADO: ['estimado', 'estimados'] };
      caja.innerHTML = Object.entries(NOMBRES)
        .map(([t, [uno, varios]]) => { const n = r.porTipo[t] || 0; return `<span class="tipo-dato ${TIPO_CLASE[t]}">${fmt(n)} ${n === 1 ? uno : varios}</span>`; }).join(' ');
    } catch {
      caja.textContent = 'El tabulador no está disponible en este momento.';
    }
  }

  function pintarKpisTab(r) {
    const t = r.total;
    $('#tKpis').innerHTML = `
      <div><b>${fmt(t)}</b><small>conceptos en el catálogo</small></div>
      <div><b>${fmt(pct(r.porTipo['OFICIAL CAPCEE'], t), 0)} %</b><small>oficiales del CAPCEE</small></div>
      <div><b>${fmt(pct(r.porTipo.ESTIMADO, t), 0)} %</b><small>estimados, por validar con el CAPCEE</small></div>`;
  }

  function pintarTablaTab() {
    const total = tab.conceptos.length;
    const paginas = Math.max(1, Math.ceil(total / POR_PAGINA));
    tab.pagina = Math.min(Math.max(0, tab.pagina), paginas - 1);
    const ini = tab.pagina * POR_PAGINA;
    const filas = tab.conceptos.slice(ini, ini + POR_PAGINA);
    $('#tTabla tbody').innerHTML = filas.length
      ? filas.map((c) => `<tr>
          <td data-l="Clave"><code>${esc(c.clave_ref)}</code></td>
          <td data-l="Concepto">${esc(c.concepto)}</td>
          <td data-l="Unidad">${esc(c.unidad)}</td>
          <td data-l="Precio sin IVA" class="n">${precioTab(c)}</td>
          <td data-l="Capítulo">${esc(c.capitulo)}</td>
          <td data-l="Partida">${esc(c.partida_generica) || '–'}</td>
          <td data-l="Tipo">${etiquetaTipo(c)}</td>
          <td data-l="">${botonAgregar(c)}</td>
        </tr>`).join('')
      : '<tr><td colspan="8" class="celda-vacia">Ningún concepto coincide. Prueba con otra palabra o quita los filtros.</td></tr>';
    $('#tConteo').textContent = total ? `Conceptos ${fmt(ini + 1)}–${fmt(ini + filas.length)} de ${fmt(total)}` : '';
    $('#tPag').textContent = `Página ${tab.pagina + 1} de ${paginas}`;
    $('#tAnt').disabled = tab.pagina === 0;
    $('#tSig').disabled = tab.pagina >= paginas - 1;
  }

  function pintarRechazadosTab(lista = []) {
    const d = $('#tRechazados');
    d.hidden = !lista.length;
    d.innerHTML = lista.length
      ? `<summary>${fmt(lista.length)} renglones del CSV no se cargaron</summary><ul>${lista.map((x) => `<li>Renglón ${x.fila}${x.clave_ref ? ` (${esc(x.clave_ref)})` : ''}: ${esc(x.motivos.join('; '))}</li>`).join('')}</ul><p class="nota">Corrígelos en data/capcee/tabulador.csv; los demás conceptos sí están disponibles.</p>`
      : '';
  }

  let esperaTab = null;
  $('#tBuscar').addEventListener('input', () => { clearTimeout(esperaTab); esperaTab = setTimeout(cargarTabulador, 250); });
  ['#tCapitulo', '#tTipo'].forEach((s) => $(s).addEventListener('change', cargarTabulador));
  const irPaginaTab = (d) => { tab.pagina += d; pintarTablaTab(); $('#tTabla').closest('.scroll').scrollTop = 0; };
  $('#tAnt').addEventListener('click', () => irPaginaTab(-1));
  $('#tSig').addEventListener('click', () => irPaginaTab(1));

  // Globo con la fuente del precio: con el mouse, el teclado o un toque.
  const globo = Object.assign(document.createElement('div'), { className: 'globo', hidden: true });
  globo.setAttribute('role', 'tooltip');
  document.body.append(globo);
  // ---------- Presupuesto ----------
  // La interfaz solo junta los datos; el cálculo lo hace el servidor (lib/presupuesto.js).
  const pres = { renglones: [], pedido: 0 }; // renglones: [{ clave_ref, cantidad, concepto }]
  const BORRADOR = 'piani.presupuesto.borrador';
  const enPres = (clave) => pres.renglones.some((r) => r.clave_ref === clave);
  function botonAgregar(c) {
    const ya = enPres(c.clave_ref);
    return `<button type="button" class="agregar${ya ? ' agregado' : ''}" data-agregar="${esc(c.clave_ref)}" aria-pressed="${ya}" aria-label="${esc(`${ya ? 'Ya está en el presupuesto' : 'Agregar al presupuesto'}: ${c.clave_ref}`)}">${ya ? 'Agregado' : 'Agregar'}</button>`;
  }

  const VISTAS_TAB = { cat: ['#tVistaCat', '#tVerCat'], pres: ['#tVistaPres', '#tVerPres'], guard: ['#tVistaGuard', '#tVerGuard'], admin: ['#tVistaAdmin', '#tVerAdmin'] };
  function verVistaTab(cual) {
    for (const [k, [vista, boton]] of Object.entries(VISTAS_TAB)) {
      const activa = k === cual;
      $(vista).hidden = !activa;
      $(boton).classList.toggle('activo', activa);
      $(boton).setAttribute('aria-pressed', String(activa));
    }
    if (cual === 'pres') recalcular(0);
    if (cual === 'guard') { mostrarListaGuard(); cargarGuardados(); }
    if (cual === 'admin') cargarAdmin();
  }
  $('#tVerAdmin').addEventListener('click', () => verVistaTab('admin'));
  $('#tVerCat').addEventListener('click', () => verVistaTab('cat'));
  $('#tVerPres').addEventListener('click', () => verVistaTab('pres'));
  $('#tVerGuard').addEventListener('click', () => verVistaTab('guard'));
  $('#pIrCat').addEventListener('click', () => { verVistaTab('cat'); $('#tBuscar').focus(); });

  // Diálogo de confirmación propio de la página (no usa confirm() del navegador).
  // Abre con el foco en "Cancelar"; Escape también cancela. Devuelve true si se acepta.
  function confirmar({ titulo, texto, aceptar = 'Borrar', peligro = true }) {
    const d = $('#dlgConfirmar');
    $('#dlgTitulo').textContent = titulo;
    $('#dlgTexto').textContent = texto;
    $('#dlgSi').textContent = aceptar;
    $('#dlgSi').className = peligro ? 'peligro' : 'primario';
    const regreso = document.activeElement;
    return new Promise((resolver) => {
      d.returnValue = 'no';
      d.addEventListener('close', () => {
        resolver(d.returnValue === 'si');
        if (regreso?.isConnected) regreso.focus();
      }, { once: true });
      d.showModal();
      $('#dlgNo').focus();
    });
  }
  // Clic en el fondo oscuro = cancelar.
  $('#dlgConfirmar').addEventListener('click', (e) => { if (e.target === e.currentTarget) e.currentTarget.close('no'); });

  $('#tTabla').addEventListener('click', (e) => {
    const b = e.target.closest('[data-agregar]');
    if (!b) return;
    const c = tab.conceptos.find((x) => x.clave_ref === b.dataset.agregar);
    if (!c || enPres(c.clave_ref)) return;
    pres.renglones.push({ clave_ref: c.clave_ref, cantidad: 1, concepto: c });
    $('#pAnuncio').textContent = `${c.clave_ref} agregado al presupuesto.`;
    cambioPres();
    $(`#tTabla [data-agregar="${CSS.escape(c.clave_ref)}"]`)?.focus(); // el teclado sigue donde estaba
  });

  // Estructura de la tabla: solo cambia al agregar o quitar conceptos.
  function pintarRenglonesPres() {
    const n = pres.renglones.length;
    $('#tNumPres').textContent = n;
    $('#pVacio').hidden = n > 0;
    $('#pLista').hidden = n === 0;
    $('#pTabla tbody').innerHTML = pres.renglones.map(({ concepto: c, cantidad }) => {
      const pctj = c.unidad === '%';
      const id = `pc-${c.clave_ref.replace(/[^\w-]/g, '_')}`;
      return `<tr data-clave="${esc(c.clave_ref)}">
        <td data-l="Concepto"><code>${esc(c.clave_ref)}</code> ${etiquetaTipo(c)}<br><span id="${id}">${esc(c.concepto)}</span><span class="pct-base nota"></span></td>
        <td data-l="Cantidad">${pctj
          ? '<span class="cant-fija" title="Los conceptos en % llevan cantidad 1">1 vez</span>'
          : `<span class="cant"><input class="cantidad" type="number" min="0" step="any" inputmode="decimal" value="${esc(cantidad)}" aria-label="${esc(`Cantidad en ${c.unidad} de ${c.clave_ref}`)}" aria-describedby="${id}"><span class="u">${esc(c.unidad)}</span></span>`}</td>
        <td data-l="Precio sin IVA" class="n">${precioTab(c)}</td>
        <td data-l="Factores" class="n factores" data-fcon="${pctj ? '' : esc(dos(c.factor_regional))}">${pctj ? 'No aplica' : `${dos(c.factor_regional)} × –`}</td>
        <td data-l="Importe" class="n importe">–</td>
        <td data-l=""><button type="button" class="quitar" data-quitar="${esc(c.clave_ref)}" aria-label="Quitar ${esc(c.clave_ref)} del presupuesto">Quitar</button></td>
      </tr>`;
    }).join('');
  }

  $('#pTabla').addEventListener('input', (e) => {
    if (!e.target.matches('.cantidad')) return;
    const clave = e.target.closest('tr').dataset.clave;
    const r = pres.renglones.find((x) => x.clave_ref === clave);
    r.cantidad = e.target.value === '' ? '' : Number(e.target.value);
    const malo = !(Number(e.target.value) > 0);
    e.target.setAttribute('aria-invalid', String(malo));
    guardarBorrador();
    recalcular();
  });
  $('#pTabla').addEventListener('click', (e) => {
    const b = e.target.closest('[data-quitar]');
    if (!b) return;
    const tr = b.closest('tr');
    const vecino = (tr.nextElementSibling || tr.previousElementSibling)?.dataset.clave;
    pres.renglones = pres.renglones.filter((x) => x.clave_ref !== b.dataset.quitar);
    $('#pAnuncio').textContent = `${b.dataset.quitar} se quitó del presupuesto.`;
    cambioPres();
    // El foco pasa al botón Quitar del renglón vecino, o al nombre de la obra si ya no quedan.
    (($(`#pTabla [data-quitar="${CSS.escape(vecino || '')}"]`)) || $('#pObra')).focus();
  });
  $('#pVaciar').addEventListener('click', async () => {
    if (!pres.renglones.length) return;
    const ok = await confirmar({ titulo: '¿Vaciar el presupuesto?', texto: `Se quitarán los ${pres.renglones.length} conceptos del presupuesto en curso. El nombre de la obra, el CCT y el factor se conservan.`, aceptar: 'Vaciar' });
    if (!ok) return;
    pres.renglones = [];
    $('#pAnuncio').textContent = 'Presupuesto vacío.';
    cambioPres();
    $('#pObra').focus();
  });

  // Guardar: el navegador manda solo obra, CCT, factor y {clave, cantidad}; el servidor recalcula.
  $('#pGuardar').addEventListener('click', async () => {
    if (!revisarCampos()) { $('#pObra').focus(); return; }
    const b = $('#pGuardar');
    b.disabled = true;
    b.textContent = 'Guardando…';
    try {
      const r = await fetch('/api/presupuestos', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ obra: $('#pObra').value, cct: $('#pCct').value, factor: $('#pFactor').value, renglones: pres.renglones.map((x) => ({ clave_ref: x.clave_ref, cantidad: x.cantidad })) }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        const lista = j.errores?.length ? j.errores : [j.error || 'No se pudo guardar.'];
        $('#pErrores').hidden = false;
        $('#pErrores').innerHTML = `<b>No se guardó:</b><ul>${lista.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`;
        return;
      }
      // Guardado: se limpia el presupuesto en curso de este navegador.
      pres.renglones = [];
      $('#pObra').value = ''; $('#pCct').value = ''; $('#pFactor').value = '1.00';
      cambioPres();
      try { localStorage.removeItem(BORRADOR); } catch { /* sin almacenamiento */ }
      verVistaTab('guard');
      mensajeGuard(`Se guardó “${j.obra}” con un total de ${dinero(j.total)}.`);
      $('#tVerGuard').focus();
    } catch {
      $('#pErrores').hidden = false;
      $('#pErrores').textContent = 'No hay conexión con el servidor; el presupuesto sigue aquí sin guardar.';
    } finally {
      b.disabled = false;
      b.textContent = 'Guardar presupuesto';
    }
  });

  // Validación inmediata de los campos (el servidor vuelve a validar todo).
  function revisarCampos() {
    const obra = $('#pObra').value.trim();
    const faltaObra = !obra && pres.renglones.length > 0; // no regañar con el presupuesto vacío
    $('#pObra').setAttribute('aria-invalid', String(faltaObra));
    $('#pObraMsg').textContent = faltaObra ? 'Escribe el nombre de la obra para calcular.' : '';
    const cct = $('#pCct').value.trim().toUpperCase();
    let msg = '';
    if (cct && cct.length !== 10) msg = `El CCT debe tener 10 caracteres (lleva ${cct.length}).`;
    else if (cct && !cct.startsWith('21')) msg = 'El CCT debe empezar con 21 (Puebla).';
    else if (cct && !/^21[A-Z]{3}\d{4}[A-Z]$/.test(cct)) msg = 'Formato esperado: 21DPR1273G.';
    $('#pCct').setAttribute('aria-invalid', String(!!msg));
    $('#pCctMsg').textContent = msg;
    return !!obra && !msg;
  }
  $('#pCct').addEventListener('input', (e) => {
    const p = e.target.selectionStart;
    e.target.value = e.target.value.toUpperCase(); // se guarda en mayúsculas
    e.target.setSelectionRange(p, p);
  });
  ['#pObra', '#pCct', '#pFactor'].forEach((s) => $(s).addEventListener('input', () => { guardarBorrador(); recalcular(); }));
  $('#formPres').addEventListener('submit', (e) => e.preventDefault());

  function cambioPres() {
    pintarRenglonesPres();
    if (tab.conceptos.length) pintarTablaTab(); // botones Agregar/Agregado del catálogo
    guardarBorrador();
    recalcular(0);
  }

  let esperaPres = null;
  function recalcular(ms = 300) {
    clearTimeout(esperaPres);
    esperaPres = setTimeout(calcularPres, ms);
  }
  async function calcularPres() {
    const camposOk = revisarCampos();
    const ocultar = () => { $('#pResultado').hidden = true; };
    if (!pres.renglones.length) { $('#pErrores').hidden = true; ocultar(); return; }
    if (!camposOk) { $('#pErrores').hidden = true; ocultar(); return; }
    const n = ++pres.pedido;
    const cuerpo = {
      obra: $('#pObra').value, cct: $('#pCct').value, factor: $('#pFactor').value,
      renglones: pres.renglones.map((r) => ({ clave_ref: r.clave_ref, cantidad: r.cantidad })),
    };
    const resp = await fetch('/api/presupuesto/calcular', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) }).catch(() => null);
    if (n !== pres.pedido) return;
    const j = resp ? await resp.json().catch(() => ({})) : { error: 'No hay conexión con el servidor.' };
    if (!resp || !resp.ok) {
      ocultar();
      const lista = j.errores?.length ? j.errores : [j.error || 'No se pudo calcular el presupuesto.'];
      $('#pErrores').hidden = false;
      $('#pErrores').innerHTML = `<b>Revisa el presupuesto:</b><ul>${lista.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`;
      $$('#pTabla .importe').forEach((td) => { td.textContent = '–'; });
      return;
    }
    $('#pErrores').hidden = true;
    pintarResultadoPres(j);
  }

  function pintarResultadoPres(p) {
    for (const r of p.renglones) {
      const tr = $(`#pTabla tr[data-clave="${CSS.escape(r.clave_ref)}"]`);
      if (!tr) continue;
      tr.querySelector('.importe').textContent = dinero(r.importe);
      const f = tr.querySelector('.factores');
      f.textContent = r.factor_presupuesto === null ? 'No aplica' : `${dos(r.factor_concepto)} × ${dos(r.factor_presupuesto)}`;
      f.title = r.factor_presupuesto === null ? 'Los conceptos en % no llevan factores' : `Concepto ${dos(r.factor_concepto)} × presupuesto ${dos(r.factor_presupuesto)}`;
      tr.querySelector('.pct-base').textContent = r.porcentaje_de_base === null ? '' : ` ${dos(r.precio)} % de ${dinero(r.porcentaje_de_base)} (obra del capítulo 6000)`;
    }
    $('#pAvisoEst').hidden = !p.aviso;
    $('#pAvisoEst').textContent = p.aviso || '';
    $('#pSub').textContent = dinero(p.subtotal);
    $('#pIva').textContent = dinero(p.iva);
    $('#pTot').textContent = dinero(p.total);
    $('#pDesglose').innerHTML = htmlDesglose(p.desglose);
    $('#pResultado').hidden = false;
  }
  const htmlDesglose = (desglose) => desglose.map((c) => `
      <div class="des-cap">
        <div class="des-fila des-n1"><span>Capítulo ${esc(c.capitulo)}</span><b>${dinero(c.importe)}</b></div>
        ${c.genericas.map((g) => `
          <div class="des-fila des-n2"><span>${esc(g.partida)}</span><b>${dinero(g.importe)}</b></div>
          ${g.especificas.map((s) => `
            <div class="des-fila des-n3"><span class="${s.partida === 'Pendiente COGAPE' ? 'pendiente' : ''}">${esc(s.partida)} <small>${s.claves.map(esc).join(', ')}</small></span><b>${dinero(s.importe)}</b></div>`).join('')}`).join('')}
      </div>`).join('');

  // ---------- Presupuestos guardados ----------
  const guard = { lista: [], pagina: 0 };
  const fechaMX = (iso) => new Date(iso).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Mexico_City' });
  const ETQ_ANTERIOR = '<span class="etq-anterior" title="Los precios de este presupuesto son distintos a los del tabulador actual. Se conservan los de la fecha en que se guardó.">calculado con tabulador anterior</span>';
  function mensajeGuard(txt) { $('#gMsg').textContent = txt; $('#gMsg').hidden = !txt; }
  function mostrarListaGuard() { $('#gLista').hidden = false; $('#gFicha').hidden = true; }

  async function cargarGuardados() {
    try {
      const j = await apiTab('/api/presupuestos');
      guard.lista = j.presupuestos;
      $('#gAvisoDisco').textContent = j.aviso;
      $('#tNumGuard').textContent = j.presupuestos.length;
      pintarGuardados();
    } catch (e) {
      $('#gConteo').textContent = `No se pudieron cargar los presupuestos guardados: ${e.message}`;
    }
  }
  function pintarGuardados() {
    const total = guard.lista.length;
    const paginas = Math.max(1, Math.ceil(total / POR_PAGINA));
    guard.pagina = Math.min(Math.max(0, guard.pagina), paginas - 1);
    const ini = guard.pagina * POR_PAGINA;
    const filas = guard.lista.slice(ini, ini + POR_PAGINA);
    $('#gVacio').hidden = total > 0;
    $('#gTablaCaja').hidden = total === 0;
    $('#gPaginador').hidden = total <= POR_PAGINA;
    $('#gConteo').textContent = total ? `Presupuestos ${fmt(ini + 1)}–${fmt(ini + filas.length)} de ${fmt(total)}, del más reciente al más antiguo.` : '';
    $('#gPag').textContent = `Página ${guard.pagina + 1} de ${paginas}`;
    $('#gAnt').disabled = guard.pagina === 0;
    $('#gSig').disabled = guard.pagina >= paginas - 1;
    $('#gTabla tbody').innerHTML = filas.map((p) => `<tr data-id="${esc(p.id)}">
        <td data-l="Obra"><b>${esc(p.obra)}</b>${p.tabuladorAnterior ? `<br>${ETQ_ANTERIOR}` : ''}${p.hayEstimados ? ' <span class="tipo-dato estimado">con estimados</span>' : ''}</td>
        <td data-l="CCT">${p.cct ? `<code>${esc(p.cct)}</code>` : '–'}</td>
        <td data-l="Fecha">${esc(fechaMX(p.fecha))}</td>
        <td data-l="Total" class="n"><b>${dinero(p.total)}</b></td>
        <td data-l="" class="acciones-g">
          <button type="button" data-ver="${esc(p.id)}" aria-label="${esc(`Ver ${p.obra}`)}">Ver</button>
          <a class="boton" href="/api/presupuestos/${encodeURIComponent(p.id)}/csv" download aria-label="${esc(`Exportar a CSV ${p.obra}`)}">Exportar</a>
          <button type="button" class="peligro-suave" data-borrar="${esc(p.id)}" aria-label="${esc(`Borrar ${p.obra}`)}">Borrar</button>
        </td>
      </tr>`).join('');
  }
  $('#gAnt').addEventListener('click', () => { guard.pagina--; pintarGuardados(); });
  $('#gSig').addEventListener('click', () => { guard.pagina++; pintarGuardados(); });
  $('#gIrPres').addEventListener('click', () => { verVistaTab('pres'); $('#pObra').focus(); });
  $('#gVolver').addEventListener('click', () => { mostrarListaGuard(); cargarGuardados().then(() => $(`#gTabla [data-ver="${CSS.escape(guard.abierto || '')}"]`)?.focus()); });

  $('#tVistaGuard').addEventListener('click', async (e) => {
    const ver = e.target.closest('[data-ver]');
    const borrar = e.target.closest('[data-borrar]');
    const recursos = e.target.closest('[data-recursos]');
    if (ver) abrirGuardado(ver.dataset.ver);
    if (borrar) borrarGuardado(borrar.dataset.borrar);
    if (recursos) usarEnRecursos(recursos.dataset.recursos);
  });

  async function abrirGuardado(id) {
    let p;
    try { p = await apiTab(`/api/presupuestos/${encodeURIComponent(id)}`); } catch (e) { mensajeGuard(`No se pudo abrir: ${e.message}`); return; }
    guard.abierto = id;
    mensajeGuard('');
    const cambios = p.comparacion?.cambios || [];
    $('#gFichaCont').innerHTML = `
      <h2 class="ficha-titulo" tabindex="-1">${esc(p.obra)}</h2>
      ${cambios.length ? `<div class="aviso-anterior">${ETQ_ANTERIOR}<p>Este presupuesto conserva los precios del día en que se guardó. Desde entonces cambió el tabulador:</p><ul>${cambios.map((c) => `<li><code>${esc(c.clave_ref)}</code>: ${esc(c.motivo)}</li>`).join('')}</ul></div>` : ''}
      <dl class="ficha-meta">
        <div><dt>CCT</dt><dd>${p.cct ? esc(p.cct) : 'Sin CCT'}</dd></div>
        <div><dt>Guardado</dt><dd>${esc(fechaMX(p.fecha))}</dd></div>
        <div><dt>Factor del presupuesto</dt><dd>${dos(p.factor_presupuesto)}</dd></div>
        <div><dt>Huella del tabulador</dt><dd><code title="${esc(p.tabulador.huella)}">${esc(p.tabulador.huella.slice(0, 12))}…</code></dd></div>
      </dl>
      <div class="tabla-pres"><table class="stack tabla-ficha"><thead><tr><th>Concepto</th><th class="n">Cantidad</th><th class="n">Precio sin IVA</th><th class="n">Factores</th><th class="n">Importe</th></tr></thead><tbody>
        ${p.renglones.map((r) => `<tr>
          <td data-l="Concepto"><code>${esc(r.clave_ref)}</code> ${etiquetaTipo(r)}<br>${esc(r.concepto)}${r.porcentaje_de_base !== null ? `<span class="nota pct-base">${dos(r.precio)} % de ${dinero(r.porcentaje_de_base)}</span>` : ''}</td>
          <td data-l="Cantidad" class="n">${r.unidad === '%' ? '1 vez' : `${fmt(r.cantidad, 3)} ${esc(r.unidad)}`}</td>
          <td data-l="Precio sin IVA" class="n">${precioTab(r)}</td>
          <td data-l="Factores" class="n">${r.factor_presupuesto === null ? 'No aplica' : `${dos(r.factor_concepto)} × ${dos(r.factor_presupuesto)}`}</td>
          <td data-l="Importe" class="n"><b>${dinero(r.importe)}</b></td>
        </tr>`).join('')}
      </tbody></table></div>
      ${p.aviso ? `<p class="aviso-estimado" role="note">${esc(p.aviso)}</p>` : ''}
      <dl class="totales">
        <div><dt>Subtotal</dt><dd>${dinero(p.subtotal)}</dd></div>
        <div><dt>IVA 16 %</dt><dd>${dinero(p.iva)}</dd></div>
        <div class="total"><dt>Total</dt><dd>${dinero(p.total)}</dd></div>
      </dl>
      <h3>Desglose por partida</h3>
      <div class="desglose">${htmlDesglose(p.desglose)}</div>
      <div class="fila acciones-pres">
        <a class="boton primario" href="/api/presupuestos/${encodeURIComponent(p.id)}/csv" download>Exportar CSV</a>
        <button type="button" data-recursos="${esc(p.id)}" ${p.recursosCapcee ? 'disabled' : ''}>${p.recursosCapcee ? 'Disponible en Recursos CAPCEE' : 'Usar en Recursos CAPCEE'}</button>
        <button type="button" class="peligro-suave" data-borrar="${esc(p.id)}">Borrar</button>
      </div>
      <p class="nota" id="gRecursosNota">${p.recursosCapcee ? `Marcado para Recursos CAPCEE: ${esc(fechaMX(p.recursosCapcee))}` : 'Recursos CAPCEE (asignación por fuente y priorización) todavía no existe: este botón deja el presupuesto listo para cuando se construya.'}</p>`;
    $('#gLista').hidden = true;
    $('#gFicha').hidden = false;
    $('#gFichaCont .ficha-titulo').focus();
  }

  async function borrarGuardado(id) {
    const p = guard.lista.find((x) => x.id === id);
    const nombre = p ? `“${p.obra}” (${dinero(p.total)})` : 'este presupuesto';
    const ok = await confirmar({ titulo: '¿Borrar el presupuesto guardado?', texto: `Se borrará ${nombre}. No se puede deshacer; si lo necesitas, expórtalo a CSV antes.`, aceptar: 'Borrar' });
    if (!ok) return;
    const r = await fetch(`/api/presupuestos/${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => null);
    if (!r || !r.ok) { mensajeGuard('No se pudo borrar el presupuesto. Intenta de nuevo.'); return; }
    const i = guard.lista.findIndex((x) => x.id === id);
    mostrarListaGuard();
    await cargarGuardados();
    mensajeGuard(`Se borró ${nombre}.`);
    // El foco pasa al "Ver" del presupuesto que quedó en su lugar, o al botón Guardados.
    const sig = guard.lista[Math.min(i, guard.lista.length - 1)];
    (sig && $(`#gTabla [data-ver="${CSS.escape(sig.id)}"]`) || $('#tVerGuard')).focus();
  }

  async function usarEnRecursos(id) {
    const r = await fetch(`/api/presupuestos/${encodeURIComponent(id)}/recursos`, { method: 'POST' }).catch(() => null);
    if (!r || !r.ok) { mensajeGuard('No se pudo marcar para Recursos CAPCEE.'); return; }
    const j = await r.json();
    const b = $(`#gFichaCont [data-recursos="${CSS.escape(id)}"]`);
    if (b) { b.disabled = true; b.textContent = 'Disponible en Recursos CAPCEE'; }
    $('#gRecursosNota').textContent = `Marcado para Recursos CAPCEE: ${fechaMX(j.marcadoEn)}`;
  }

  // ---------- Actualizar precios (cargar tabulador) ----------
  // Protegido en el servidor con TABULADOR_ADMIN_KEY. La clave solo vive en el campo; no se guarda.
  const adm = { habilitado: false, previa: null, archivo: null, actual: null };
  const precioU = (v, unidad) => (unidad === '%' ? `${dos(v)} %` : dinero(v));
  const signo = (x) => (x > 0 ? '+' : x < 0 ? '−' : '');
  const pl = (n, uno, varios) => `${fmt(n)} ${n === 1 ? uno : varios}`;

  async function cargarAdmin() {
    let h;
    try { h = await apiTab('/api/tabulador/historial'); } catch (e) { $('#aErrores').hidden = false; $('#aErrores').textContent = e.message; return; }
    adm.habilitado = h.habilitado;
    adm.actual = h.actual;
    $('#aAvisoRender').textContent = h.aviso;
    $('#aDeshabilitado').hidden = h.habilitado;
    for (const s of ['#aClave', '#aArchivo', '#aCargar']) $(s).disabled = !h.habilitado;
    if (h.habilitado) $('#aCargar').removeAttribute('aria-describedby'); else $('#aCargar').setAttribute('aria-describedby', 'aDeshabTxt');
    $('#aActual').innerHTML = h.actual
      ? `<div><dt>Tabulador vigente</dt><dd>${fmt(h.actual.conceptos)} conceptos</dd></div>
         <div><dt>Huella</dt><dd><code title="${esc(h.actual.huella)}">${esc(h.actual.huella.slice(0, 12))}…</code></dd></div>
         <div><dt>Archivo modificado</dt><dd>${esc(fechaMX(h.actual.actualizado))}</dd></div>`
      : '<div><dt>Tabulador vigente</dt><dd>No hay un tabulador válido cargado</dd></div>';
    $('#aHistVacio').hidden = h.versiones.length > 0;
    $('#aHistCaja').hidden = !h.versiones.length;
    $('#aHist tbody').innerHTML = h.versiones.map((v) => `<tr>
        <td data-l="Fecha">${esc(v.fecha)}</td>
        <td data-l="Huella"><code title="${esc(v.huella)}">${esc(v.huella.slice(0, 12))}…</code></td>
        <td data-l="Conceptos" class="n">${v.valido ? fmt(v.conceptos) : 'con errores'}</td>
        <td data-l=""><button type="button" data-restaurar="${esc(v.archivo)}" data-fecha="${esc(v.fecha)}" data-conceptos="${esc(v.conceptos ?? '')}" ${h.habilitado && v.valido ? '' : 'disabled'} aria-label="${esc(`Restaurar la versión del ${v.fecha}`)}">Restaurar</button></td>
      </tr>`).join('');
  }

  function erroresAdmin(titulo, lista) {
    $('#aErrores').hidden = false;
    $('#aErrores').innerHTML = `<b>${esc(titulo)}</b>${lista?.length ? `<ul>${lista.map((e) => `<li>${e.fila ? `Renglón ${e.fila}` : 'Archivo'}${e.clave_ref ? ` (${esc(e.clave_ref)})` : ''}: ${esc((e.motivos || [e]).join('; '))}</li>`).join('')}</ul>` : ''}`;
  }
  function limpiarPrevia() { adm.previa = null; $('#aPrevia').hidden = true; $('#aPrevia').innerHTML = ''; }
  $('#aArchivo').addEventListener('change', () => { limpiarPrevia(); $('#aErrores').hidden = true; mensajeAdmin(''); });
  function mensajeAdmin(t) { $('#aMsg').textContent = t; $('#aMsg').hidden = !t; }
  const pedirClave = () => {
    const clave = $('#aClave').value;
    if (!clave) { erroresAdmin('Escribe la clave de administración.'); $('#aClave').focus(); }
    return clave;
  };

  $('#formCarga').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!adm.habilitado) return;
    $('#aErrores').hidden = true; mensajeAdmin(''); limpiarPrevia();
    const clave = pedirClave();
    if (!clave) return;
    const archivo = $('#aArchivo').files[0];
    if (!archivo) { erroresAdmin('Elige el archivo CSV del tabulador nuevo.'); $('#aArchivo').focus(); return; }
    if (archivo.size > 1024 * 1024) { erroresAdmin('El archivo pesa más de 1 MB.'); return; }
    $('#aCargar').disabled = true; $('#aCargar').textContent = 'Revisando el archivo…';
    try {
      // Se manda el archivo tal cual (con su BOM); el servidor valida y compara sin aplicar.
      const r = await fetch('/api/tabulador/previsualizar', { method: 'POST', headers: { 'Content-Type': 'text/csv', 'X-Admin-Key': clave }, body: archivo });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { erroresAdmin(j.error || `Error ${r.status}`, j.errores); return; }
      adm.previa = j; adm.archivo = archivo;
      pintarPrevia(j);
    } catch { erroresAdmin('No hay conexión con el servidor.'); } finally {
      $('#aCargar').disabled = !adm.habilitado; $('#aCargar').textContent = 'Cargar tabulador';
    }
  });

  function pintarPrevia(j) {
    const d = j.diferencias;
    const usado = (n) => (n ? `<span class="etq-usado">Usado en ${n} presupuesto${n === 1 ? '' : 's'} guardado${n === 1 ? '' : 's'}</span>` : '');
    const cambio = (c, unidad) => {
      if (c.campo === 'precio') return '';
      const v = (x) => (c.campo === 'factor_regional' ? dos(x) : (x === '' ? '(vacía)' : esc(x)));
      return `<li><b>${esc(c.nombre)}:</b> ${v(c.antes)} → ${v(c.despues)}</li>`;
    };
    const tablaMod = d.modificados.map((m) => `<tr class="${m.presupuestos ? 'usado' : ''}">
        <td data-l="Concepto"><code>${esc(m.clave_ref)}</code> ${etiquetaTipo(m)}<br>${esc(m.concepto)}${m.presupuestos ? `<br>${usado(m.presupuestos)}` : ''}</td>
        <td data-l="Qué cambió"><ul class="cambios">
          ${m.precio ? `<li><b>precio:</b> ${precioU(m.precio.antes, m.unidad)} → ${precioU(m.precio.despues, m.unidad)} <span class="dif ${m.precio.difMxn > 0 ? 'sube' : 'baja'}">${signo(m.precio.difMxn)}${m.unidad === '%' ? `${dos(Math.abs(m.precio.difMxn))} pts` : dinero(Math.abs(m.precio.difMxn))} (${signo(m.precio.difPct)}${fmt(Math.abs(m.precio.difPct), 1)} %)</span></li>` : ''}
          ${m.cambios.map((c) => cambio(c, m.unidad)).join('')}
        </ul></td>
      </tr>`).join('');
    const tablaElim = d.eliminados.map((x) => `<tr class="${x.presupuestos ? 'usado' : ''}">
        <td data-l="Concepto"><code>${esc(x.clave_ref)}</code> ${etiquetaTipo(x)}<br>${esc(x.concepto)}${x.presupuestos ? `<br>${usado(x.presupuestos)}` : ''}</td>
        <td data-l="Precio" class="n">${precioU(x.precio, x.unidad)}</td>
      </tr>`).join('');
    const tablaNuevos = d.nuevos.map((x) => `<tr>
        <td data-l="Concepto"><code>${esc(x.clave_ref)}</code><br>${esc(x.concepto)}</td>
        <td data-l="Precio" class="n">${precioU(x.precio, x.unidad)} <small>/ ${esc(x.unidad)}</small></td>
        <td data-l="Tipo">${etiquetaTipo(x)}</td>
      </tr>`).join('');
    $('#aPrevia').innerHTML = `
      <h2 tabindex="-1" id="aPreviaTitulo">Cambios contra el tabulador vigente</h2>
      <p class="nota">Esto es una vista previa: todavía no se aplicó nada. Archivo nuevo: ${fmt(j.conceptosNuevos)} conceptos (vigente: ${fmt(j.conceptosActuales)}).</p>
      <ul class="resumen-cambios">
        <li><b>${fmt(d.nuevos.length)}</b> ${d.nuevos.length === 1 ? 'nuevo' : 'nuevos'}</li>
        <li><b>${fmt(d.eliminados.length)}</b> ${d.eliminados.length === 1 ? 'eliminado' : 'eliminados'}</li>
        <li><b>${fmt(d.modificados.length)}</b> ${d.modificados.length === 1 ? 'modificado' : 'modificados'}</li>
        <li><b>${fmt(d.sinCambio)}</b> sin cambio</li>
      </ul>
      ${d.presupuestosAfectados ? `<div class="aviso-anterior"><b>${fmt(d.presupuestosAfectados)} presupuesto${d.presupuestosAfectados === 1 ? '' : 's'} guardado${d.presupuestosAfectados === 1 ? '' : 's'} usa${d.presupuestosAfectados === 1 ? '' : 'n'} conceptos que se eliminan o cambian</b> (resaltados abajo). No cambian: conservan los precios con los que se guardaron (copia fija) y se marcarán como “calculado con tabulador anterior”.</div>` : ''}
      ${d.identico ? '<p class="msg-ok">El archivo es igual al tabulador vigente: no hay nada que aplicar.</p>' : ''}
      ${d.modificados.length ? `<h3>Modificados</h3><div class="tabla-pres"><table class="stack tabla-dif"><thead><tr><th>Concepto</th><th>Qué cambió</th></tr></thead><tbody>${tablaMod}</tbody></table></div>` : ''}
      ${d.eliminados.length ? `<h3>Eliminados</h3><div class="tabla-pres"><table class="stack tabla-dif"><thead><tr><th>Concepto</th><th class="n">Precio</th></tr></thead><tbody>${tablaElim}</tbody></table></div>` : ''}
      ${d.nuevos.length ? `<h3>Nuevos</h3><div class="tabla-pres"><table class="stack tabla-dif"><thead><tr><th>Concepto</th><th class="n">Precio</th><th>Tipo</th></tr></thead><tbody>${tablaNuevos}</tbody></table></div>` : ''}
      ${d.identico ? '' : `<div class="fila acciones-pres">
        <button type="button" id="aAplicar" class="primario">Aplicar tabulador nuevo</button>
        <button type="button" id="aDescartar">Descartar</button>
      </div>`}`;
    $('#aPrevia').hidden = false;
    $('#aPreviaTitulo').focus();
  }

  $('#aPrevia').addEventListener('click', async (e) => {
    if (e.target.id === 'aDescartar') { limpiarPrevia(); $('#aArchivo').value = ''; $('#aArchivo').focus(); return; }
    if (e.target.id !== 'aAplicar' || !adm.previa) return;
    const d = adm.previa.diferencias;
    const ok = await confirmar({
      titulo: '¿Aplicar el tabulador nuevo?',
      texto: `Se reemplazará el tabulador vigente (${adm.previa.conceptosActuales} conceptos) por el nuevo (${adm.previa.conceptosNuevos}): ${pl(d.nuevos.length, 'nuevo', 'nuevos')}, ${pl(d.eliminados.length, 'eliminado', 'eliminados')} y ${pl(d.modificados.length, 'modificado', 'modificados')}. El vigente se guarda en el historial y se puede restaurar. Los presupuestos guardados no cambian.`,
      aceptar: 'Aplicar', peligro: false,
    });
    if (!ok) return;
    const clave = pedirClave();
    if (!clave) return;
    const b = e.target;
    b.disabled = true; b.textContent = 'Aplicando…';
    try {
      const r = await fetch('/api/tabulador/aplicar', {
        method: 'POST',
        headers: { 'Content-Type': 'text/csv', 'X-Admin-Key': clave, 'X-Huella-Base': adm.previa.base, 'X-Huella-Nueva': adm.previa.huellaNueva },
        body: adm.archivo,
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { erroresAdmin(j.error || `Error ${r.status}`, j.errores); b.disabled = false; b.textContent = 'Aplicar tabulador nuevo'; return; }
      limpiarPrevia();
      $('#aArchivo').value = '';
      await tabuladorCambio();
      mensajeAdmin(`Listo: el tabulador nuevo (${j.conceptos} conceptos) ya está en uso.${j.respaldo ? ` El anterior quedó en el historial como ${j.respaldo}.` : ''}`);
      $('#aMsg').setAttribute('tabindex', '-1'); $('#aMsg').focus();
    } catch { erroresAdmin('No hay conexión con el servidor; no se aplicó nada.'); b.disabled = false; b.textContent = 'Aplicar tabulador nuevo'; }
  });

  $('#aHist').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-restaurar]');
    if (!b) return;
    $('#aErrores').hidden = true; mensajeAdmin('');
    const ok = await confirmar({
      titulo: '¿Restaurar esta versión?',
      texto: `Se usará el tabulador del ${b.dataset.fecha} (${b.dataset.conceptos} conceptos). El vigente se guarda antes en el historial. Los presupuestos guardados no cambian.`,
      aceptar: 'Restaurar', peligro: false,
    });
    if (!ok) return;
    const clave = pedirClave();
    if (!clave) return;
    const r = await fetch('/api/tabulador/restaurar', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Admin-Key': clave }, body: JSON.stringify({ archivo: b.dataset.restaurar }) }).catch(() => null);
    const j = r ? await r.json().catch(() => ({})) : { error: 'No hay conexión con el servidor.' };
    if (!r || !r.ok) { erroresAdmin(j.error || 'No se pudo restaurar.', j.errores); return; }
    limpiarPrevia();
    await tabuladorCambio();
    mensajeAdmin(`Listo: se restauró la versión del ${b.dataset.fecha} (${j.conceptos} conceptos). La que estaba quedó en el historial.`);
    $('#aMsg').setAttribute('tabindex', '-1'); $('#aMsg').focus();
  });

  // Tras aplicar o restaurar: catálogo, indicadores, guardados (etiquetas) e historial, sin recargar la página.
  async function tabuladorCambio() {
    await Promise.all([cargarTabulador(), cargarGuardados(), cargarAdmin(), pintarInicioTab()]);
    // Los conceptos del presupuesto en curso toman los datos nuevos; los que ya no existen se quitan.
    const cat = await apiTab('/api/tabulador').catch(() => null);
    if (cat && pres.renglones.length) {
      const porClave = new Map(cat.conceptos.map((c) => [c.clave_ref, c]));
      const antes = pres.renglones.length;
      pres.renglones = pres.renglones.filter((r) => porClave.has(r.clave_ref)).map((r) => ({ ...r, concepto: porClave.get(r.clave_ref) }));
      if (pres.renglones.length < antes) $('#pAnuncio').textContent = `${antes - pres.renglones.length} concepto(s) del presupuesto en curso ya no existen y se quitaron.`;
      cambioPres();
    }
  }

  // Borrador en este navegador (el guardado real está en el servidor, ver Guardados).
  function guardarBorrador() {
    try {
      localStorage.setItem(BORRADOR, JSON.stringify({
        obra: $('#pObra').value, cct: $('#pCct').value, factor: $('#pFactor').value,
        renglones: pres.renglones.map((r) => ({ clave_ref: r.clave_ref, cantidad: r.cantidad })),
      }));
    } catch { /* sin almacenamiento: no pasa nada */ }
  }
  async function restaurarBorrador() {
    let b = null;
    try { b = JSON.parse(localStorage.getItem(BORRADOR) || 'null'); } catch { b = null; }
    if (!b) return;
    $('#pObra').value = b.obra || '';
    $('#pCct').value = b.cct || '';
    $('#pFactor').value = b.factor || '1.00';
    if (Array.isArray(b.renglones) && b.renglones.length) {
      const cat = await apiTab('/api/tabulador').catch(() => null);
      if (cat) {
        const porClave = new Map(cat.conceptos.map((c) => [c.clave_ref, c]));
        pres.renglones = b.renglones.filter((r) => porClave.has(r.clave_ref)).map((r) => ({ ...r, concepto: porClave.get(r.clave_ref) }));
      }
    }
    pintarRenglonesPres();
  }
  restaurarBorrador();

  let globoDe = null; // etiqueta a la que pertenece el globo visible
  function colocarGlobo() {
    if (!globoDe) return;
    const r = globoDe.getBoundingClientRect();
    if (!globoDe.isConnected || r.bottom < 0 || r.top > window.innerHeight) { ocultarGlobo(); return; }
    const x = Math.min(window.innerWidth - globo.offsetWidth - 8, Math.max(8, r.left + r.width / 2 - globo.offsetWidth / 2));
    const arriba = r.top - globo.offsetHeight - 8;
    globo.style.left = `${x}px`;
    globo.style.top = `${arriba >= 8 ? arriba : r.bottom + 8}px`;
  }
  function mostrarGlobo(el) {
    globoDe = el;
    globo.textContent = `Fuente: ${el.dataset.fuente}`;
    globo.hidden = false;
    colocarGlobo();
  }
  function ocultarGlobo() { globoDe = null; globo.hidden = true; }
  document.addEventListener('mouseover', (e) => { const el = e.target.closest('[data-fuente]'); if (el) mostrarGlobo(el); });
  document.addEventListener('mouseout', (e) => { if (e.target.closest('[data-fuente]') && document.activeElement !== globoDe) ocultarGlobo(); });
  document.addEventListener('focusin', (e) => { const el = e.target.closest('[data-fuente]'); if (el) mostrarGlobo(el); else ocultarGlobo(); });
  document.addEventListener('focusout', (e) => { if (e.target === globoDe) ocultarGlobo(); });
  // Al desplazar la tabla o la página, el globo sigue a su etiqueta (se oculta si sale de la vista).
  document.addEventListener('scroll', () => requestAnimationFrame(colocarGlobo), true);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') ocultarGlobo(); });

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
  // ---------- Ancho del panel: divisor arrastrable entre el panel y el mapa ----------
  // Se arrastra con el mouse o el dedo; con el teclado: flechas (Mayús = pasos grandes), Inicio y Fin.
  // Doble clic regresa al ancho original. Se recuerda en este navegador, aparte para Municipios y Tabulador (panel amplio).
  const ANCHO_MIN = 280; // panel más angosto que se permite
  const MAPA_MIN = 320; // el mapa nunca queda más angosto que esto
  const ANCHOS = { normal: ['--ancho-panel', 'piani.anchoPanel'], amplio: ['--ancho-panel-amplio', 'piani.anchoPanelAmplio'] };
  const divisor = $('#divisor');
  const panelEl = $('#panel');
  const modoAncho = () => (document.body.classList.contains('ancho') ? 'amplio' : 'normal');
  const limitesAncho = () => ({ min: ANCHO_MIN, max: Math.max(ANCHO_MIN, window.innerWidth - panelEl.getBoundingClientRect().left - MAPA_MIN) });
  const recortar = (px) => { const { min, max } = limitesAncho(); return Math.round(Math.min(max, Math.max(min, px))); };
  function ariaAncho() {
    const { min, max } = limitesAncho();
    const v = Math.round(panelEl.getBoundingClientRect().width);
    divisor.setAttribute('aria-valuemin', min);
    divisor.setAttribute('aria-valuemax', Math.round(max));
    divisor.setAttribute('aria-valuenow', v);
    divisor.setAttribute('aria-valuetext', `Panel de ${v} píxeles`);
  }
  function fijarAncho(px, { guardar = true, modo = modoAncho() } = {}) {
    const [variable, clave] = ANCHOS[modo];
    const v = recortar(px);
    document.documentElement.style.setProperty(variable, `${v}px`);
    if (guardar) { try { localStorage.setItem(clave, String(v)); } catch { /* sin almacenamiento */ } }
    return v;
  }
  function anchoOriginal() {
    const [variable, clave] = ANCHOS[modoAncho()];
    document.documentElement.style.removeProperty(variable);
    try { localStorage.removeItem(clave); } catch { /* sin almacenamiento */ }
    mapa.invalidateSize();
    ariaAncho();
  }
  // Al cargar: aplica los anchos guardados (sin pasar del espacio disponible).
  for (const [modo, [, clave]] of Object.entries(ANCHOS)) {
    let v = null;
    try { v = Number(localStorage.getItem(clave)) || null; } catch { v = null; }
    if (v) fijarAncho(v, { guardar: false, modo });
  }

  divisor.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    divisor.setPointerCapture(e.pointerId);
    document.body.classList.add('arrastrando');
    const izq = panelEl.getBoundingClientRect().left;
    let pendiente = null;
    const mover = (ev) => {
      pendiente = ev.clientX - izq;
      requestAnimationFrame(() => { if (pendiente !== null) { fijarAncho(pendiente, { guardar: false }); pendiente = null; } });
    };
    const soltar = (ev) => {
      divisor.removeEventListener('pointermove', mover);
      divisor.removeEventListener('pointerup', soltar);
      divisor.removeEventListener('pointercancel', soltar);
      document.body.classList.remove('arrastrando');
      fijarAncho(ev.clientX - izq);
      mapa.invalidateSize();
      ariaAncho();
    };
    divisor.addEventListener('pointermove', mover);
    divisor.addEventListener('pointerup', soltar);
    divisor.addEventListener('pointercancel', soltar);
  });
  divisor.addEventListener('dblclick', anchoOriginal);
  divisor.addEventListener('focus', ariaAncho);
  divisor.addEventListener('keydown', (e) => {
    const actual = panelEl.getBoundingClientRect().width;
    const paso = e.shiftKey ? 96 : 24;
    const nuevo = { ArrowLeft: actual - paso, ArrowRight: actual + paso, Home: ANCHO_MIN, End: Infinity }[e.key];
    if (nuevo === undefined) return;
    e.preventDefault();
    fijarAncho(nuevo);
    mapa.invalidateSize();
    ariaAncho();
  });
  // Si la ventana se achica, el panel guardado se recorta para que el mapa siga visible.
  let esperaVentana = null;
  window.addEventListener('resize', () => {
    clearTimeout(esperaVentana);
    esperaVentana = setTimeout(() => {
      for (const [modo, [variable]] of Object.entries(ANCHOS)) {
        const v = parseFloat(document.documentElement.style.getPropertyValue(variable));
        if (v) fijarAncho(v, { guardar: false, modo });
      }
      mapa.invalidateSize();
      ariaAncho();
    }, 150);
  });
  // Al cambiar de sección (Municipios usa otro ancho) el valor para lectores de pantalla se actualiza.
  new MutationObserver(() => requestAnimationFrame(ariaAncho)).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  ariaAncho();

  iniciar();
})();
