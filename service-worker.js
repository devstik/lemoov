const CACHE_VERSION = 'lemoov-v13';
const APP_SHELL = [
  '/catalogo-produtos.html',
  '/cliente-login.html',
  '/styles.css',
  '/script.js',
  '/manifest.json',
  '/image/logo_lemoov_semfundo.png',
  '/image/logo_lemoov_icon.png',
  '/image/icons/icon-192.png',
  '/image/icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_VERSION).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname === '/api/produtos') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response && response.ok) caches.open(CACHE_VERSION).then((cache) => cache.put(request, response.clone()));
          return response;
        })
        .catch(() => caches.match(request))
    );
    return;
  }
  if (url.pathname.startsWith('/api/')) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match('/catalogo-produtos.html'))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          if (response && response.ok) {
            caches.open(CACHE_VERSION).then((cache) => cache.put(request, response.clone()));
          }
          return response;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
