// Mic (Mohamed) — service worker: makes the dashboard installable and opens instantly.
// Network-first (you always get the newest version); cache is only a fallback. /api/* is never cached.
const CACHE = 'mic-mohamed-v1';
const SHELL = ['/', '/clay.html', '/engine-web.js', '/pwa.js', '/rnnoise-worklet.js', '/vendor/rnnoise-sync.js',
  '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/favicon-32.png'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {})); self.skipWaiting(); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))); self.clients.claim(); });
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin || u.pathname.startsWith('/api/')) return;
  e.respondWith(fetch(e.request).then((res) => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
    return res;
  }).catch(async () => (await caches.match(e.request)) || (e.request.mode === 'navigate' ? caches.match('/') : Response.error())));
});
