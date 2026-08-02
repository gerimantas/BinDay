/**
 * Does Švara's seroval server function answer from a GitHub runner?
 *
 * Resolves the app's own address to a contract, then fetches its schedule — the two calls
 * the pipeline needs. `getschedule` requires `tenantId` in the payload and takes
 * `wasteObjectId`, not `hashedId`; without the tenant it answers 200 with an empty result
 * rather than an error, so an empty schedule here means a malformed request, not an outage.
 */

import { toJSONAsync } from 'seroval';

const FN = '540255adfb554d07c113b436aa5260c344d105f4d25780c646c3d51db39960be';
const HEADERS = {
  'x-tsr-serverFn': 'true',
  accept: 'application/x-tss-framed, application/x-ndjson, application/json',
};
const EXPECT_INVENTORY = '52-MK-036668';

/** Minimal seroval reader — enough for the object/array/string/bool shapes this API returns. */
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
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${apiPath.slice(0, 60)}`);
  return plain(await res.json());
}

const q = o => new URLSearchParams(o).toString();

const started = Date.now();
let contracts;
try {
  contracts = await api('/schedule/getcontracts?' + q({
    region: 'Kauno r. sav.', subDistrict: 'Garliavos apylinkių sen.', city: 'Juragių k.',
    address: 'Žalgirio g.', houseNumber: '8A', search: '', pageSize: 10, pageIndex: 0,
  }));
} catch (err) {
  console.log(`FAIL: ${err.message}`);
  process.exit(1);
}

const row = contracts.result?.data?.[0];
if (!row) {
  console.log('FAIL: getcontracts returned no rows — reachable but answering empty');
  process.exit(1);
}
console.log(`OK: ${row.fullAddress} / ${row.inventoryNumber} / wasteObjectId=${row.wasteObjectId}`);

if (row.inventoryNumber !== EXPECT_INVENTORY) {
  console.log(`FAIL: expected ${EXPECT_INVENTORY}, got ${row.inventoryNumber}`);
  process.exit(1);
}

const schedule = await api('/schedule/getschedule?' + q({
  wasteObjectId: row.wasteObjectId, address: '-', subDistrict: '-', region: '-',
  houseNumber: '-', pageSize: 100, pageIndex: 0,
}));
const dates = (schedule.result || []).map(d => d.dateFmt);
console.log(`schedule: ${dates.length} dates in ${((Date.now() - started) / 1000).toFixed(1)}s`);
console.log(`  first six: ${dates.slice(0, 6).join(', ')}`);

if (!dates.length) {
  console.log('FAIL: empty schedule — tenantId or wasteObjectId rejected');
  process.exit(1);
}
// The published window genuinely deviates; this Wednesday run is the canary that the
// runner receives real published dates rather than a smoothed or cached substitute.
console.log(`  off-cycle 2026-07-22 present: ${dates.includes('2026-07-22')}`);
console.log('Švara reachable from this runner.');
