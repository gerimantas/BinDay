// Bump CACHE on every deploy that changes index.html, or clients keep serving
// the stale schedule from cache indefinitely. tools/build_app.py does this
// automatically — do not rely on remembering.
const CACHE = 'binday-v29';

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
// 7.4 MB, and downloading a municipality on install would be a long silent
// stall for a user who may never open the address picker. It is cached on first
// use instead — see the fetch handler.
const DATA = /\/dist\/.*\.json$/;

// version.json must NEVER be cached, and must never be answered from the cache.
// It is the signal that the cached data is out of date, so serving it
// cache-first would mean the app compares the new build against a stale copy of
// its own signature and concludes nothing changed — the update would never fire
// on exactly the deploy it exists to deliver.
const NEVER_CACHE = /\/dist\/version\.json$/;

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
  const path = new URL(e.request.url).pathname;

  // Straight to the network, never cached, and a failure stays a failure: the
  // caller treats any error as "no signal, keep what we have".
  if (NEVER_CACHE.test(path)) {
    e.respondWith(fetch(e.request));
    return;
  }

  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(res => {
        // Cache only a real success. Storing an error or opaque response would
        // pin a 404 into the cache, and cache-first would then serve it forever
        // — the failure mode that makes a fixed deploy look broken.
        if (res.ok && res.type === 'basic' && DATA.test(path)) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, copy));
        }
        return res;
      });
    })
  );
});
