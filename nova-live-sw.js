'use strict';

const CACHE_NAME = 'nova-live-pwa-20260501a';
const APP_SHELL = [
  '/nova-live.html',
  '/nova-live.css?v=20260501b',
  '/nova-live.js?v=20260501b',
  '/nova-live.webmanifest?v=20260501a',
  '/nova-live-app-icon.svg',
  '/nova-live-icon-192.png',
  '/nova-live-icon-512.png',
  '/nova-live-apple-touch-icon.png',
  '/nova-live-cover.svg',
  '/nova-clips.html',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys
        .filter((key) => key.startsWith('nova-live-pwa-') && key !== CACHE_NAME)
        .map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const requestUrl = new URL(request.url);

  if (request.method !== 'GET' || requestUrl.origin !== self.location.origin) {
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put('/nova-live.html', copy));
          return response;
        })
        .catch(() => caches.match('/nova-live.html')),
    );
    return;
  }

  event.respondWith(
    caches.match(request)
      .then((cached) => {
        const network = fetch(request)
          .then((response) => {
            if (response && response.ok) {
              const copy = response.clone();
              caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
            }
            return response;
          })
          .catch(() => cached);
        return cached || network;
      }),
  );
});
