// Bump CACHE on every deploy that changes index.html, or clients keep serving
// the stale schedule from cache indefinitely. tools/build_app.py does this
// automatically — do not rely on remembering.
const CACHE = 'binday-v12';

// The app shell. Pre-cached on install so the app opens with no signal.
const ASSETS = [
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png',
  './favicon.ico'
];

// Catalogue data is deliberately NOT pre-cached: dist/kauno-r-sav/data.json is
// 4.6 MB, and downloading a municipality on install would be a long silent
// stall for a user who may never open the address picker. It is cached on first
// use instead — see the fetch handler.
const DATA = /\/dist\/.*\.json$/;

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Cache-first: the schedule is static data and the app must work with no signal
// at the kerb. A new version arrives via the CACHE bump on the next load.
//
// Data files are additionally written into the cache on first fetch. Before
// this, `cache.put` appeared nowhere in the file: a runtime fetch was served
// from the network or not at all, so the address picker did not work offline —
// and on the live site it did not work at all, because the directory it read
// from is gitignored and 404s.
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(res => {
        // Cache only a real success. Storing an error or opaque response would
        // pin a 404 into the cache, and cache-first would then serve it forever
        // — the failure mode that makes a fixed deploy look broken.
        if (res.ok && res.type === 'basic' &&
            DATA.test(new URL(e.request.url).pathname)) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, copy));
        }
        return res;
      });
    })
  );
});
