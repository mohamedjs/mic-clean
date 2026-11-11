// Mic Clean — service worker (browser use only): makes the page installable and opens instantly.
// Network-first (you always get the newest version); cache is only a fallback. /api/* is never cached.
const CACHE = 'mic-clean-v2';
const SHELL = ['/', '/css/app.css', '/css/scenes.css', '/css/calibrate.css', '/css/layout.css', '/shared/presets.js',
  '/js/dashboard.js', '/js/legacy.js', '/js/scenes.js', '/js/calibrate.js', '/js/setup.js', '/js/engine-web.js', '/js/pwa.js',
  '/js/audio/rnnoise-worklet.js', '/js/audio/vendor/rnnoise-sync.js',
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
