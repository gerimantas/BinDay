// Bump CACHE on every deploy that changes index.html, or clients keep serving
// the stale schedule from cache indefinitely. tools/build_app.py does this
// automatically — do not rely on remembering.
const CACHE = 'binday-v37';

// The app shell. Pre-cached on install so the app opens with no signal.
const ASSETS = [
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png',
  './favicon.ico'
];

// A new worker waits instead of taking over, and the page offers the update;
// the page posts SKIP_WAITING when the user accepts. Taking over unasked swapped
// the code under an open page and gave no sign a new schedule had arrived.
//
// Transitional: pages from binday-v26 and earlier have no offer to show, so a
// worker replacing one of those still takes over at once, as before. Drop this
// once no such cache can remain on a phone.
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(ASSETS))
      .then(() => caches.keys())
      .then(keys => {
        const old = keys.map(k => Number((k.match(/^binday-v(\d+)$/) || [])[1]))
          .filter(n => n && n <= 26);
        if (old.length) self.skipWaiting();
      })
  );
});

self.addEventListener('message', e => {
  if (e.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Cache-first: the schedule ships inside index.html and the app must work with no
// signal at the kerb. A new version arrives via the CACHE bump on the next load.
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(caches.match(e.request).then(cached => cached || fetch(e.request)));
});
