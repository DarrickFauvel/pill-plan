const CACHE = 'medigrid-v1';

const SHELL = [
  '/css/tokens.css',
  '/css/base.css',
  '/css/components.css',
  '/css/grid.css',
  '/js/app.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const { request } = e;
  if (request.method !== 'GET') return;
  if (new URL(request.url).pathname.startsWith('/api/')) return;

  e.respondWith(
    caches.match(request).then((cached) => cached ?? fetch(request))
  );
});
