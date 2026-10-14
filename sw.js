// Service worker: la app funciona sin conexión. Estrategia: RED PRIMERO para
// que cada actualización publicada llegue de inmediato; si no hay internet se
// usa la copia guardada. Los datos viven en IndexedDB (no en caché).
const VERSION = 'mcc-v2.3.0';
const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './js/app.js',
  './js/core/dates.js',
  './js/core/ids.js',
  './js/core/money.js',
  './js/domain/activities.js',
  './js/domain/agenda.js',
  './js/domain/backup.js',
  './js/domain/catalog-nogal.js',
  './js/domain/clients.js',
  './js/domain/commands.js',
  './js/domain/commissions.js',
  './js/domain/common.js',
  './js/domain/csv.js',
  './js/domain/documents.js',
  './js/domain/ledger.js',
  './js/domain/metrics.js',
  './js/domain/migrate.js',
  './js/domain/payments.js',
  './js/domain/products.js',
  './js/domain/schema.js',
  './js/domain/settings.js',
  './js/domain/whatsapp.js',
  './js/store/persistence.js',
  './js/store/store.js',
  './js/ui/dom.js',
  './js/ui/exports.js',
  './js/ui/forms.js',
  './js/ui/quote.js',
  './js/ui/state.js',
  './js/ui/views-cartera.js',
  './js/ui/views-clients.js',
  './js/ui/views-commissions.js',
  './js/ui/views-home.js',
  './js/ui/views-more.js',
  './js/ui/views-sales.js',
  './js/core/pdf-metrics.js',
  './js/core/pdf.js',
  './js/domain/analytics.js',
  './js/domain/nlp.js',
  './js/domain/pricing.js',
  './js/ui/pdf-docs.js',
  './js/ui/quicklog.js',
  './fonts/fraunces-latin.woff2',
  './fonts/inter-latin.woff2',
  './js/ui/icons.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION && k.startsWith('mcc-')).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
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
