#!/usr/bin/env node
/**
 * Build the Švara address catalogue, one JSON file per municipality.
 *
 * Švara's backend is a TanStack server function whose payload is seroval-encoded; plain
 * JSON returns "Seroval Error (step: 3)". See the `binday` skill for the traps this file
 * already works around — in particular the query parameter is `region`, not `district`
 * (passing `district` returns HTTP 200 with every municipality in the country), and
 * `subDistrict` is mandatory or `totalRecords` comes back 0 rather than everything.
 *
 *   npm i seroval
 *   node tools/fetch_svara.js            # writes data/raw/svara/
 *
 * Writes whole files into raw/ and never deletes: a municipality that fails leaves its
 * previous file intact and the build uses that. Every municipality is attempted before
 * the run exits non-zero, so one failure does not hide the state of the rest.
 *
 * Measured: 138 182 containers across 8 municipalities (Alytaus m. sav. is listed but
 * empty). `getcontracts` carries hashedId, so the resulting catalogue is enough to fetch
 * a schedule PDF later without re-resolving the address.
 */

import { toJSONAsync } from 'seroval';
import { join } from 'node:path';
import { writeJson, rawPath, RAW } from './atomic.mjs';

const FN = '540255adfb554d07c113b436aa5260c344d105f4d25780c646c3d51db39960be';
const HEADERS = {
  'x-tsr-serverFn': 'true',
  accept: 'application/x-tss-framed, application/x-ndjson, application/json',
};
const PAGE_SIZE = 1000;          // largest accepted; a full page takes ~13 s

const args = process.argv.slice(2);
// Fetch output goes to raw/, which this script writes and never deletes.
// Anything derived from it belongs in dist/, owned by the build step.
const outDir = args.includes('--out') ? args[args.indexOf('--out') + 1]
                                      : join(RAW, 'svara');

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
  if (n.t === 25) {                       // $TSR/Error — carries its fields in `s`
    const o = {};
    for (const [key, val] of Object.entries(n.s || {})) o[key] = plain(val);
    return o;
  }
  return n.s ?? null;
}

async function api(apiPath, attempt = 0) {
  const node = await toJSONAsync({ data: { apiPath } });   // the `data` wrapper is required
  const url = `https://grafikai.svara.lt/_serverFn/${FN}?payload=` +
    encodeURIComponent(JSON.stringify(node));
  try {
    const res = await fetch(url, { headers: HEADERS });
    const body = plain(await res.json());
    // `error` is a boolean here and is `true` on SUCCESS — it is not an error object.
    // A real failure arrives as an object carrying `message` (e.g. a $TSR/Error node).
    if (body?.error && typeof body.error === 'object' && body.error.message) {
      throw new Error(String(body.error.message).slice(0, 140));
    }
    if (body?.result === undefined) {
      throw new Error('no result field: ' + JSON.stringify(body).slice(0, 140));
    }
    return body.result;
  } catch (err) {
    if (attempt < 2) {
      await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
      return api(apiPath, attempt + 1);
    }
    throw err;
  }
}

const q = o => new URLSearchParams(o).toString();

/* Waste type from Švara's description, falling back to the inventory number's infix.
 *
 * `description` is not always a waste type: in Kauno r. it reads "Mišrios atliekos", but
 * in Kaišiadorys every row says "Kaišiadorys" — the town. Relying on it alone left a whole
 * municipality as OTHER, so every container showed a grey dot instead of its bin colour.
 * The infix (52-MK-…, 49-SA-…) is the more reliable signal, and the two disagree rarely
 * enough that description-first with an infix fallback covers both shapes.
 */
const INFIX_TYPE = {
  MK: 'MIXED', KA: 'MIXED', MA: 'MIXED', L: 'MIXED', M: 'MIXED',
  P: 'PACKAGING', PA: 'PACKAGING', PK: 'PACKAGING',
  S: 'GLASS', SA: 'GLASS', ST: 'GLASS',
  Z: 'GREEN', ZA: 'GREEN', ZL: 'GREEN',
};

function wasteType(description, inventory) {
  const d = String(description || '').toLowerCase();
  if (d.includes('mišri')) return 'MIXED';
  if (d.includes('žali')) return 'GREEN';
  if (d.includes('pakuot')) return 'PACKAGING';
  if (d.includes('stikl')) return 'GLASS';
  if (d.includes('antrin')) return 'RECYCLABLE';
  if (d.includes('popier')) return 'PAPER';
  // Not every number carries the municipality prefix — Kauno m. writes "MA-000017"
  // where Kauno r. writes "52-MK-036668". Taking part [1] therefore lands on a serial
  // number in the city and leaves the whole municipality unclassified, so scan every
  // alphabetic segment instead of a fixed position.
  for (const part of String(inventory || '').split('-')) {
    const t = INFIX_TYPE[part.trim().toUpperCase()];
    if (t) return t;
  }
  return 'OTHER';
}

const slug = s => s.replace(/\s+/g, '-').replace(/[^\p{L}\p{N}-]/gu, '').toLowerCase();

async function main() {
  const districts = await api('/schedule/getdistricts?search=');
  console.log(`Švara covers ${districts.length} municipalities`);
  console.log(`writing to ${outDir}/ — this run never deletes\n`);

  const index = [];
  const failed = [];
  for (const { district: region } of districts) {
    // One municipality failing must not abandon the rest: a missing new file is
    // not a deleted old one, so the previous fetch stays and the build uses it.
    // Every unit is attempted; the run exits non-zero at the end if any failed.
    try {
      const subs = await api('/schedule/getsubdistricts?' + q({ region, search: '' }));
      const entries = [];
      for (const { subdistrict } of subs) {
        for (let page = 0; ; page++) {
          const r = await api('/schedule/getcontracts?' + q({
            region, subDistrict: subdistrict, city: '', address: '', houseNumber: '',
            search: '', pageSize: PAGE_SIZE, pageIndex: page,
          }));
          for (const c of r.data || []) {
            // A few rows come back with inventoryNumber === false rather than a string.
            // Keep them — the address and hashedId are still good, and the hashedId is
            // what fetches the schedule — but never let a boolean reach the catalogue,
            // where downstream code calls .split() on it.
            const inv = typeof c.inventoryNumber === 'string' ? c.inventoryNumber : '';
            if (!c.fullAddress || !c.hashedId) continue;
            entries.push([c.fullAddress, inv, wasteType(c.description, inv), c.hashedId]);
          }
          if (page + 1 >= (r.totalPages || 0)) break;
        }
        process.stdout.write(`\r  ${region}: ${entries.length} containers   `);
      }
      if (!entries.length) {
        console.log(`\r  ${region}: empty, skipped                `);
        continue;
      }
      const area = slug(region);
      const path = rawPath('svara', area, 'contracts');
      writeJson(path, {
        operator: 'UAB Kauno švara', municipality: region,
        count: entries.length, entries,
      }, { source: 'svara/getcontracts', request: { region } });
      index.push({ operator: 'Švara', municipality: region,
                   count: entries.length, area, file: path });
      console.log(`\r  ${region}: ${entries.length} -> ${path}          `);
    } catch (err) {
      failed.push({ region, error: err.message });
      console.log(`\r  ${region}: FAILED (${err.message}) — previous file kept`);
    }
  }

  writeJson(join(RAW, 'svara', 'index.json'),
    { generated: new Date().toISOString().slice(0, 10), areas: index },
    { source: 'svara/getdistricts' });
  console.log(`\nwrote ${index.length} municipality files under ${RAW}/svara/`);

  if (failed.length) {
    console.error(`\n${failed.length} municipalities failed:`);
    for (const f of failed) console.error(`   ${f.region}: ${f.error}`);
    process.exit(1);
  }
}

main().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
