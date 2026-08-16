const CACHE_VERSION = 'lemoov-v22';
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
  '/image/icons/icon-maskable-192-v2.png',
  '/image/icons/icon-maskable-512-v2.png',
  '/image/icons/apple-touch-icon-v2.png',
  '/image/icons/favicon-bege-32.png',
  '/image/icons/favicon-bege-48.png',
  '/image/icons/favicon-light-ui-32.png',
  '/image/icons/favicon-light-ui-48.png',
  '/image/icons/favicon-dark-ui-32.png',
  '/image/icons/favicon-dark-ui-48.png',
  '/image/icons/apple-splash-1170x2532.png',
  '/image/icons/apple-splash-1290x2796.png',
  '/image/icons/apple-splash-1242x2688.png',
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
