// v2: a cópia guardada é a última que veio da rede (a v1 guardava o index.html só na instalação e, com o sinal
// fraco no celular, abria um menu de meses atrás — sem Pedidos, Lucro das vendas, Promoções)
const CACHE_NAME = 'caixa360-v2';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  const req = e.request;
  // Sempre da rede, sem cópia: Supabase, APIs externas e tudo que não é do próprio site
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  // Rede primeiro (sem o cache do navegador); a cópia só é usada sem internet e é sempre a mais recente
  e.respondWith(
    fetch(req, { cache: 'no-cache' }).then(r => {
      if (r.ok) { const c = r.clone(); caches.open(CACHE_NAME).then(cache => cache.put(req, c)); }
      return r;
    }).catch(() => caches.match(req).then(r => r || caches.match('/caixa360/index.html')))
  );
});
