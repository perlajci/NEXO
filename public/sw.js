// Service worker de la página pública: la guarda para abrirla sin internet.
const CACHE = 'nexo-cerca-v1';
const ARCHIVOS = ['cerca.html', 'manifest.webmanifest'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ARCHIVOS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  const esPagina = ARCHIVOS.some((a) => url.pathname.endsWith(a));
  const esLista = url.pathname.endsWith('/api/albergues/publicos');
  if (!esPagina && !esLista) return;
  // Primero la red (para tener lo más nuevo); si no hay red, lo guardado.
  e.respondWith(
    fetch(e.request)
      .then((r) => { const copia = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copia)); return r; })
      .catch(() => caches.match(e.request, { ignoreSearch: true })),
  );
});
