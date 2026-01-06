// Simple Service Worker for PWA installability
self.addEventListener('install', (e) => {
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (e) => {
  // Pass through all requests to network
  // This satisfies the PWA requirement of having a fetch handler
  e.respondWith(fetch(e.request));
});