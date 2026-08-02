/**
 * Fetch Švara pickup dates for every container in an area, into raw/.
 *
 *   node tools/fetch_dates_svara.mjs               # all containers in dist/
 *   node tools/fetch_dates_svara.mjs --limit 50    # a sample, for a dry run
 *
 * Švara has no bulk date endpoint: getschedule takes one wasteObjectId and
 * returns that container's dates. Measured at 63 ms per call with no rate
 * limiting (200 back-to-back, 0 failures), so ~57 000 containers is about an
 * hour. Requests are issued with a small concurrency window rather than one at
 * a time, since the limit is round-trip latency, not the operator.
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
const CONCURRENCY = 8;
const RETRIES = 3;

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};
const area = opt('--area', 'kauno-r-sav');
const limit = Number(opt('--limit', 0));

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
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return plain(await res.json());
}
const q = o => new URLSearchParams(o).toString();

async function schedule(wasteObjectId) {
  // Retries are for transport failures only — there is no rate limit to back
  // off from (measured), so a failure here means a dropped connection.
  let lastErr;
  for (let attempt = 0; attempt < RETRIES; attempt++) {
    try {
      const r = await api('/schedule/getschedule?' + q({
        wasteObjectId, address: '-', subDistrict: '-', region: '-',
        houseNumber: '-', pageSize: 200, pageIndex: 0,
      }));
      return (r.result || []).map(d => d.dateFmt).filter(Boolean);
    } catch (e) {
      lastErr = e;
      await new Promise(r => setTimeout(r, 200 * (attempt + 1)));
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

  // One request per distinct wasteObjectId: several containers can share one,
  // and the schedule is a property of the object, not of the row.
  const byObject = new Map();
  for (const [address, inv, type, hashedId, wasteObjectId] of raw.entries) {
    if (!wasteObjectId) continue;
    if (!byObject.has(wasteObjectId)) byObject.set(wasteObjectId, []);
    byObject.get(wasteObjectId).push({ address, inventory: inv, type });
  }
  let objects = [...byObject.keys()];
  if (limit) objects = objects.slice(0, limit);
  console.log(`${objects.length} distinct wasteObjectIds ` +
    `(${raw.entries.length} catalogue rows)`);

  const dates = {};
  const failed = [];
  let done = 0;
  const t0 = Date.now();

  let cursor = 0;
  async function worker() {
    while (cursor < objects.length) {
      const id = objects[cursor++];
      try {
        dates[id] = await schedule(id);
      } catch (e) {
        failed.push({ id, error: String(e.message || e).slice(0, 80) });
      }
      done++;
      if (done % 2000 === 0 || done === objects.length) {
        const el = (Date.now() - t0) / 1000;
        const rate = done / el;
        console.log(`  ${done}/${objects.length}  ${el.toFixed(0)}s  ` +
          `${rate.toFixed(0)}/s  eta ${((objects.length - done) / rate / 60).toFixed(1)}min  ` +
          `failed=${failed.length}`);
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  const withDates = Object.values(dates).filter(d => d.length).length;
  writeJson(join('data', 'raw', 'svara', area, 'dates.json'),
    { area, objects: objects.length, withDates, dates },
    { source: 'svara/getschedule', request: { area } });

  console.log(`\n${withDates}/${objects.length} objects have dates, ` +
    `${failed.length} failed, ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  if (failed.length) {
    for (const f of failed.slice(0, 10)) console.error(`   ${f.id}: ${f.error}`);
    process.exitCode = 1;
  }
}
