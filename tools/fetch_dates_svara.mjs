/**
 * Fetch Švara pickup dates for every container in an area, into raw/.
 *
 *   node tools/fetch_dates_svara.mjs               # all containers in dist/
 *   node tools/fetch_dates_svara.mjs --limit 50 --dry-run  # sample without writing raw/
 *
 * Švara has no bulk date endpoint: getschedule takes one wasteObjectId. The
 * catalogue does expose scheduleIds, though, and objects with the same ID set
 * return identical published dates. Fetch one representative per schedule group
 * and fan its dates back out to every wasteObjectId in that group.
 *
 * wasteObjectId comes from the catalogue in raw/. hashedId does NOT work here —
 * measured: getschedule returns an empty result for it under every parameter
 * name — which is why fetch_svara.js carries both.
 *
 * Written as one file per area, whole, never deleting. A container that fails
 * is recorded and the run exits non-zero, but every other container is still
 * attempted and written.
 */

import { toJSONAsync } from 'seroval';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { writeJson } from './atomic.mjs';

const FN = '540255adfb554d07c113b436aa5260c344d105f4d25780c646c3d51db39960be';
const HEADERS = {
  'x-tsr-serverFn': 'true',
  accept: 'application/x-tss-framed, application/x-ndjson, application/json',
};
// The operator now throttles bursts above roughly two requests/second and embeds the 429
// inside an HTTP 200 response. Two workers stay near that limit without manufacturing
// retries; grouping keeps the complete run small enough that higher concurrency is needless.
const DEFAULT_CONCURRENCY = 2;
const RETRIES = 5;

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};
const area = opt('--area', 'kauno-r-sav');
const limit = Number(opt('--limit', 0));
const objectId = opt('--object', '');
const concurrency = Number(opt('--concurrency', DEFAULT_CONCURRENCY));
const dryRun = args.includes('--dry-run');

if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 32) {
  console.error('FAILED: --concurrency must be an integer from 1 to 32');
  process.exit(2);
}
if ((limit || objectId) && !dryRun) {
  console.error('FAILED: --limit/--object requires --dry-run so a sample cannot overwrite raw dates');
  process.exit(2);
}

function plain(n) {
  if (!n || typeof n !== 'object') return n;
  if (n.t === 1) return n.s;
  if (n.t === 2) return n.s === 1;
  if (n.t === 9) return (n.a || []).map(plain);
  if (n.t === 10 || n.t === 11) {
    const o = {}, k = n.p?.k || [], v = n.p?.v || [];
    k.forEach((key, i) => (o[key] = plain(v[i])));
    return o;
  }
  if (n.t === 25) {
    const o = {};
    for (const [key, val] of Object.entries(n.s || {})) o[key] = plain(val);
    return o;
  }
  return n.s ?? null;
}

async function api(apiPath, tenantId = 'svara') {
  const node = await toJSONAsync({ data: { apiPath, tenantId } });
  const url = `https://grafikai.svara.lt/_serverFn/${FN}?payload=` +
    encodeURIComponent(JSON.stringify(node));
  let res;
  try {
    res = await fetch(url, { headers: HEADERS });
  } catch (err) {
    err.retryable = true;
    throw err;
  }
  if (!res.ok) {
    const detail = (await res.text()).replace(/\s+/g, ' ').slice(0, 160);
    const err = new Error(`HTTP ${res.status}${detail ? `: ${detail}` : ''}`);
    err.retryable = res.status === 429 || res.status >= 500;
    const retryAfter = Number(res.headers.get('retry-after'));
    err.retryAfterMs = Number.isFinite(retryAfter) ? retryAfter * 1000 : 0;
    throw err;
  }
  return plain(await res.json());
}
const q = o => new URLSearchParams(o).toString();
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function schedule(wasteObjectId) {
  // The operator returned widespread transient failures on the September runner.
  // Retry transport, 429 and 5xx responses with enough backoff to let it recover.
  let lastErr;
  for (let attempt = 0; attempt < RETRIES; attempt++) {
    try {
      const r = await api('/schedule/getschedule?' + q({
        wasteObjectId, address: '-', subDistrict: '-', region: '-',
        houseNumber: '-', pageSize: 200, pageIndex: 0,
      }));
      if (r.error && typeof r.error === 'object') {
        const status = Number(r.error.status || 0);
        const detail = String(r.error.detail || r.error.title || JSON.stringify(r.error));
        const retrySeconds = Number(detail.match(/(?:po\s+|after\s+)?(\d+)\s*s/i)?.[1] || 0);
        const err = new Error(`operator ${status || 'error'}: ${detail}`);
        err.retryable = status === 429 || status >= 500;
        err.retryAfterMs = retrySeconds * 1000;
        throw err;
      }
      if (!Array.isArray(r.result)) {
        const sentinel = r.result === true;
        const err = new Error((sentinel ? 'temporary success sentinel without schedule: ' :
          'unexpected response shape: ') + JSON.stringify(r).slice(0, 500));
        // Under load the endpoint intermittently answers `{result: true, error: true}`.
        // The same object succeeds after a pause, so this one shape is transient.
        err.retryable = sentinel;
        throw err;
      }
      return r.result.map(d => d.dateFmt).filter(Boolean);
    } catch (e) {
      lastErr = e;
      if (e.retryable !== true || attempt === RETRIES - 1) break;
      const exponential = Math.min(8000, 500 * (2 ** attempt));
      const jitter = Math.floor(Math.random() * 250);
      await sleep(Math.max(e.retryAfterMs || 0, exponential + jitter));
    }
  }
  throw lastErr;
}

const rawPath = join('data', 'raw', 'svara', area, 'contracts.json');
if (!existsSync(rawPath)) {
  console.error(`FAILED: ${rawPath} missing — run tools/fetch_svara.js first`);
  process.exitCode = 1;
} else {
  const raw = JSON.parse(readFileSync(rawPath, 'utf8'));

  // The catalogue exposes the schedule IDs behind every waste object. Objects with the
  // same normalized ID set return the same published dates (verified across multiple
  // single- and multi-schedule groups), so fetch one representative and fan the result
  // back out by wasteObjectId. Old catalogues lack field 6 and safely fall back to one
  // request per object.
  const byObject = new Map();
  const scheduleKeyByObject = new Map();
  for (const [address, inv, type, hashedId, wasteObjectId, scheduleIds] of raw.entries) {
    if (!wasteObjectId) continue;
    if (!byObject.has(wasteObjectId)) byObject.set(wasteObjectId, []);
    byObject.get(wasteObjectId).push({ address, inventory: inv, type });
    const normalized = Array.isArray(scheduleIds)
      ? [...new Set(scheduleIds.map(String))].sort()
      : [];
    if (normalized.length) scheduleKeyByObject.set(wasteObjectId, JSON.stringify(normalized));
  }
  const grouped = new Map();
  for (const id of byObject.keys()) {
    const key = scheduleKeyByObject.get(id) || `object:${id}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(id);
  }
  if (!dryRun && scheduleKeyByObject.size < byObject.size * 0.9) {
    console.error('FAILED: this catalogue predates scheduleIds grouping - ' +
      'run tools/fetch_svara.js before fetching dates');
    process.exit(2);
  }
  let requests = [...grouped.values()].map(ids => ({ representative: ids[0], ids }));
  if (objectId) requests = [{ representative: objectId, ids: [objectId] }];
  if (limit) requests = requests.slice(0, limit);
  const selectedObjects = requests.reduce((n, request) => n + request.ids.length, 0);
  console.log(`${byObject.size} distinct wasteObjectIds in ${grouped.size} schedule groups ` +
    `(${raw.entries.length} catalogue rows; fetching ${requests.length} groups / ` +
    `${selectedObjects} objects)`);

  const dates = {};
  const failed = [];
  let done = 0;
  let abort = false;
  const t0 = Date.now();

  let cursor = 0;
  async function worker() {
    while (!abort && cursor < requests.length) {
      const request = requests[cursor++];
      const id = request.representative;
      try {
        const published = await schedule(id);
        if (request.ids.length > 1) {
          const witnessId = request.ids[1];
          const witness = await schedule(witnessId);
          const expected = JSON.stringify([...published].sort());
          const actual = JSON.stringify([...witness].sort());
          if (actual !== expected) {
            throw new Error(`scheduleIds grouping mismatch for ${id}/${witnessId}`);
          }
        }
        for (const object of request.ids) dates[object] = published;
      } catch (e) {
        const failure = { id, objects: request.ids.length,
          error: String(e.message || e).slice(0, 240) };
        failed.push(failure);
        if (failed.length <= 10) console.error(`   ${id}: ${failure.error}`);
      }
      done++;
      if (done >= Math.min(20, requests.length) && failed.length / done > 0.2) {
        abort = true;
        console.error(`FAILED: aborting early - ${failed.length}/${done} requests failed ` +
          'after all retries');
      }
      if (done % 100 === 0 || done === requests.length) {
        const el = (Date.now() - t0) / 1000;
        const rate = done / el;
        console.log(`  ${done}/${requests.length} groups  ${el.toFixed(0)}s  ` +
          `${rate.toFixed(1)}/s  eta ${((requests.length - done) / rate / 60).toFixed(1)}min  ` +
          `failed=${failed.length}`);
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));

  const withDates = Object.values(dates).filter(d => d.length).length;
  if (!dryRun && !abort) {
    writeJson(join('data', 'raw', 'svara', area, 'dates.json'),
      { area, objects: selectedObjects, groups: requests.length, withDates, dates },
      { source: 'svara/getschedule', request: { area } });
  }

  console.log(`\n${withDates}/${selectedObjects} selected objects have dates; ` +
    `${done}/${requests.length} groups processed, ${failed.length} failed, ` +
    `${((Date.now() - t0) / 1000).toFixed(0)}s`);
  if (dryRun) console.log('dry run - raw dates were not written');
  if (failed.length) {
    process.exitCode = 1;
  }
  if (abort) process.exitCode = 1;
}
