'use strict';

const CACHE_NAME = 'wagners-timecards-v20260508d';
const APP_SHELL = [
  '/wagners-timecards.html',
  '/wagners-timecards.css?v=20260508d',
  '/wagners-timecards.js?v=20260508d',
  '/nova-auth.css?v=20260503d',
  '/nova-auth.js?v=20260503d',
  '/wagners-timecards.webmanifest',
  '/assets/wagners-timecards-icon.svg',
  '/assets/wagners-timecards-icon-192.png',
  '/assets/wagners-timecards-icon-512.png',
  '/assets/wagners-timecards-apple-touch-icon.png',
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
        .filter((key) => key.startsWith('wagners-timecards-') && key !== CACHE_NAME)
        .map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put('/wagners-timecards.html', copy));
          }
          return response;
        })
        .catch(() => caches.match('/wagners-timecards.html')),
    );
    return;
  }

  const isAppAsset = APP_SHELL.some((asset) => {
    const assetUrl = new URL(asset, self.location.origin);
    return assetUrl.pathname === url.pathname;
  });
  if (!isAppAsset) return;

  event.respondWith(
    caches.match(request)
      .then((cached) => cached || fetch(request).then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      })),
  );
});
