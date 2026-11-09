const CACHE_NAME = 'al-dzikra-v3.6.0';
const CORE_ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './data/dzikir.json',
  './manifest.webmanifest',
  './manifest.webmanifest?v=3.6',
  './fonts/lpmq_isep_misbah.ttf',
  './icons/icon.svg',
  './icons/icon.svg?v=3.6',
  './icons/pagi.svg',
  './icons/petang.svg',
  './icons/sholat.svg',
  './icons/icon-192.png',
  './icons/icon-192.png?v=3.6',
  './icons/icon-512.png',
  './icons/icon-512.png?v=3.6',
  './icons/apple-touch-icon.png',
  './icons/apple-touch-icon.png?v=3.6',
  './icons/bg-dark.jpg',
  './icons/bg-light.jpg'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  const isConfigOrCode =
    request.mode === 'navigate' ||
    url.pathname.endsWith('.webmanifest') ||
    url.pathname.endsWith('.html') ||
    url.pathname.endsWith('.js') ||
    url.pathname.endsWith('.css');

  if (isConfigOrCode) {
    // Network-first for HTML, manifest, JS, and CSS so manifest/UI updates apply immediately
    event.respondWith(
      fetch(request, { cache: 'no-cache' })
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const responseClone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(request, responseClone);
            });
          }
          return networkResponse;
        })
        .catch(() =>
          caches.match(request).then((cached) => cached || caches.match('./index.html'))
        )
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }

      return fetch(request).then((networkResponse) => {
        if (
          networkResponse &&
          (networkResponse.status === 200 || networkResponse.type === 'opaque')
        ) {
          const responseClone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(request, responseClone);
          });
        }
        return networkResponse;
      });
    })
  );
});

