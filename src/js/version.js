/* ------------------------------------------------------------------
   Picking up a new build.

   The service worker is cache-first, so once an area's data.json is cached it
   is served forever — a corrected schedule would never reach the phone. The
   measured `304, 0 bytes, 0.13 s` from curl does not help here: a conditional
   request is resolved in the HTTP layer and the worker only ever sees a normal
   200 from the browser's own cache. So revalidation has to be explicit.

   Fetch version.json with cache: 'no-store' (a few hundred bytes), compare the
   per-area signature with the one stored alongside the cached data, and
   re-fetch only the areas that changed. Per-area matters: a Prienai rebuild
   must not make Kauno r. clients re-download 7 MB.

   This never blocks rendering. The app paints from cache first and swaps in new
   data only once it has arrived; with no signal nothing happens at all and the
   cached schedule stays correct, which is the right answer at the kerb.
------------------------------------------------------------------ */
const VERSION_STORE = 'binday.versions';
const CHECK_EVERY_MS = 12 * 3600 * 1000;   // twice a day is far more than enough
const LAST_CHECK = 'binday.lastVersionCheck';

function loadVersions() {
  try { return JSON.parse(localStorage.getItem(VERSION_STORE) || '{}'); }
  catch (e) { return {}; }
}

function saveVersions(v) {
  try { localStorage.setItem(VERSION_STORE, JSON.stringify(v)); }
  catch (e) { /* private mode: we simply re-check next time */ }
}

/* Schedules are published months ahead — the app's own glass horizon runs to
   2027-07-06 — so checking on every open would be pure noise. */
function dueForCheck() {
  try {
    const last = Number(localStorage.getItem(LAST_CHECK) || 0);
    return !last || (Date.now() - last) > CHECK_EVERY_MS;
  } catch (e) { return true; }
}

function markChecked() {
  try { localStorage.setItem(LAST_CHECK, String(Date.now())); }
  catch (e) { /* ignore */ }
}

/* Returns the slugs whose data changed, after refreshing them in the cache. */
async function checkForNewData({ force = false } = {}) {
  if (!force && !dueForCheck()) return [];
  let remote;
  try {
    const r = await fetch(DIST + 'version.json', { cache: 'no-store' });
    if (!r.ok) return [];
    remote = await r.json();
  } catch (e) {
    return [];                 // offline: keep what we have, say nothing
  }
  markChecked();

  const local = loadVersions();
  const changed = [];
  for (const [slug, sig] of Object.entries(remote.areas || {})) {
    if (local[slug] === sig) continue;
    /* First run has no stored signature. Record it without re-fetching: the
       data was just downloaded, so treating it as changed would download the
       same 7 MB twice. */
    if (local[slug] === undefined && areaCache.has(slug)) {
      local[slug] = sig;
      continue;
    }
    try {
      await refreshArea(slug);
      local[slug] = sig;
      changed.push(slug);
    } catch (e) { /* leave the old signature so we retry next time */ }
  }
  saveVersions(local);
  return changed;
}

/* Re-fetch one area past the service worker's cache-first handler and write the
   result back into the cache, so the next open reads the new copy.

   `cache: 'reload'` is not enough on its own: it bypasses the HTTP cache, but
   the request still passes through the worker's fetch handler, which answers
   cache-first and hands back the very copy we are trying to replace. Measured —
   the signature updated while the data did not, which is the worst of both,
   because the client then believes it is current.

   A cache-busting query parameter routes around it: the URL does not match the
   cached entry, so the worker misses and goes to the network. The response is
   then stored under the clean URL, which is what every later read asks for. */
async function refreshArea(slug) {
  const paths = [slug + '/data.json', slug + '/index.json'];
  const bust = 'v=' + Date.now();
  const fresh = [];
  for (const p of paths) {
    const res = await fetch(DIST + p + '?' + bust, { cache: 'reload' });
    if (!res.ok) throw new Error(p + ' ' + res.status);
    // Store under the ABSOLUTE, un-busted URL: that is the key the worker looks
    // up on the next read. Keying on the relative path or on the busted URL
    // would leave the stale entry in place and add an orphan beside it.
    fresh.push([new URL(DIST + p, location.href).href, res.clone()]);
  }
  // Only touch the cache once both files arrived, so a half-updated area is
  // never left behind. Absent in a plain page context (no HTTPS, no worker),
  // where the browser cache is the only layer and this is simply skipped.
  if (typeof caches !== 'undefined') {
    const c = await caches.open(await currentCacheName());
    for (const [url, res] of fresh) await c.put(url, res);
  }
  areaCache.delete(slug);
  areasIndex = null;
}

/* The worker owns the cache name and bumps it per deploy; ask the cache itself
   rather than duplicating the constant here, where it would go stale. */
async function currentCacheName() {
  const keys = await caches.keys();
  return keys.find(k => k.startsWith('binday-')) || 'binday-data';
}

/* Re-resolve the active saved address from the refreshed data, so a corrected
   schedule is actually shown rather than sitting in the cache unused. */
async function applyNewData(slugs) {
  const a = saved.list[saved.active];
  if (!a || !a.key || !slugs.includes(a.area)) return false;
  try {
    const rows = await getArea(a.area);
    const hit = rows.find(r => r.key === a.key);
    if (!hit) return false;
    a.address = hit.address;
    a.containers = hit.containers.map(c => ({ id: c.id, type: c.type,
                                              operator: c.operator }));
    a.schedule = scheduleFor(hit);
    a.collected = areaCollected.get(a.area) || null;
    persist(saved);
    applyActive();
    return true;
  } catch (e) { return false; }
}
