const CACHE_NAME = 'caixa360-v1';
const URLS_ESTATICAS = [
  '/caixa360/',
  '/caixa360/index.html',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(URLS_ESTATICAS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  // Sempre busca da rede para Supabase e APIs externas
  if (e.request.url.includes('supabase') || e.request.url.includes('anthropic') || e.request.url.includes('api.mercadolibre')) {
    return;
  }
  e.respondWith(
    fetch(e.request).catch(() => caches.match(e.request))
  );
});
