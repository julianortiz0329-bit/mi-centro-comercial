// Service worker: la app funciona sin conexión. Estrategia: RED PRIMERO para
// que cada actualización publicada llegue de inmediato; si no hay internet se
// usa la copia guardada. Los datos viven en IndexedDB (no en caché).
const VERSION = 'mcc-v3.0.0';
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
  './js/ui/personalize.js',
  './js/ui/lock.js',
  './js/ui/search.js',
  './js/domain/contact-parse.js',
  './js/domain/pethome.js',
  './js/domain/catalog-pethome.js',
  './js/ui/views-pethome.js',
  './js/ui/forms-pethome.js',
  './js/ui/pdf-pethome.js',
  './js/domain/rut-parse.js',
  './js/ui/rut-reader.js',
  './vendor/pdfjs/pdf.min.mjs',
  './vendor/pdfjs/pdf.worker.min.mjs',
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

// Compartir desde WhatsApp (u otra app) hacia Mi Centro Comercial: se guarda
// lo recibido en una caché temporal y se abre la app para crear el cliente.
const SHARE_CACHE = 'share-inbox';
async function receiveShare(request) {
  try {
    const fd = await request.formData();
    const files = [];
    const cache = await caches.open(SHARE_CACHE);
    let pdf = false;
    for (const f of fd.getAll('files').slice(0, 3)) {
      if (!f || typeof f.text !== 'function') continue;
      if ((/pdf/i.test(f.type) || /\.pdf$/i.test(f.name || '')) && f.size < 15000000) {
        await cache.put(new URL('__compartido_pdf', self.registration.scope).href, new Response(f, { headers: { 'Content-Type': 'application/pdf' } }));
        pdf = true;
      } else if (f.size < 300000) files.push({ name: f.name || '', type: f.type || '', text: await f.text() });
    }
    const payload = { at: Date.now(), title: String(fd.get('title') || ''), text: String(fd.get('text') || ''), url: String(fd.get('url') || ''), files, pdf };
    await cache.put(new URL('__compartido', self.registration.scope).href, new Response(JSON.stringify(payload), { headers: { 'Content-Type': 'application/json' } }));
  } catch {
    /* si falla, la app abre igual y avisa que no llegó nada */
  }
  return Response.redirect(new URL("#/hoy?do=compartido", self.registration.scope).href, 303);
}

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method === 'POST' && url.origin === location.origin && url.pathname.endsWith('/compartir')) {
    e.respondWith(receiveShare(e.request));
    return;
  }
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
