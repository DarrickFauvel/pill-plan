const CACHE = 'medigrid-v2';

const PRECACHE = [
  '/css/tokens.css',
  '/css/base.css',
  '/css/components.css',
  '/css/app.css',
  '/css/grid.css',
  '/js/app.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(PRECACHE))
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

/** Network-first: always fetch fresh, update cache, fall back to cache when offline. */
self.addEventListener('fetch', (e) => {
  const { request } = e;
  if (request.method !== 'GET') return;
  if (new URL(request.url).pathname.startsWith('/api/')) return;

  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      try {
        const response = await fetch(request);
        cache.put(request, response.clone());
        return response;
      } catch {
        return cache.match(request);
      }
    })
  );
});
