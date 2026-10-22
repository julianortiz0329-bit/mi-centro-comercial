// Service worker: la app abre sin internet. RED PRIMERO para que cada
// actualización llegue de inmediato; si no hay conexión se usa la copia
// guardada. Los datos del libro viven en IndexedDB y en la nube (no aquí).
const VERSION = 'alegria-v1.2.0';
const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './fonts/fraunces-latin.woff2',
  './fonts/inter-latin.woff2',
  './js/app.js',
  './js/ui/dom.js',
  './js/ui/forms-ledger.js',
  './js/ui/forms-pethome.js',
  './js/ui/icons.js',
  './js/ui/motion.js',
  './js/ui/pdf-docs.js',
  './js/ui/pdf-pethome.js',
  './js/ui/state.js',
  './js/ui/views-ledger.js',
  './js/ui/views-payables.js',
  './js/ui/views-pethome.js',
  './js/store/remote.js',
  './js/store/store.js',
  './js/domain/catalog-pethome.js',
  './js/domain/common.js',
  './js/domain/csv.js',
  './js/domain/ledger.js',
  './js/domain/pethome.js',
  './js/domain/records.js',
  './js/domain/whatsapp.js',
  './js/core/dates.js',
  './js/core/ids.js',
  './js/core/money.js',
  './js/core/pdf-metrics.js',
  './js/core/pdf.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION && k.startsWith('alegria-')).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request, { cache: 'no-cache' })
      .then((res) => {
        if (res.ok && res.type === 'basic') {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || caches.match('./index.html'))),
  );
});
