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
// The largest subdistrict (Užliedžių) is ~7 500 containers, so 8 pages. 100 is
// a runaway guard, not a limit — it exists because the loop now ends on a short
// page rather than on a page count, and a server that always returned full
// pages would otherwise spin forever.
const MAX_PAGES = 100;

const args = process.argv.slice(2);
// Fetch output goes to raw/, which this script writes and never deletes.
// Anything derived from it belongs in dist/, owned by the build step.
const outDir = args.includes('--out') ? args[args.indexOf('--out') + 1]
                                      : join(RAW, 'svara');

// Scope is Kauno r. sav. (.planning/PIPELINE_PLAN.md). Without this the fetcher
// walks all 9 Švara municipalities — roughly 13 minutes of operator traffic for
// data nothing consumes, and eight stray directories in raw/ that later steps
// would have to distinguish from real ones.
const DEFAULT_REGIONS = ['Kauno r. sav.'];
const regions = args.includes('--regions')
  ? args[args.indexOf('--regions') + 1].split(',').map(s => s.trim())
  : DEFAULT_REGIONS;
const allRegions = args.includes('--all');

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

function typeFromText(s) {
  const d = String(s || '').toLowerCase();
  if (d.includes('mišri')) return 'MIXED';
  if (d.includes('žali')) return 'GREEN';
  if (d.includes('pakuot')) return 'PACKAGING';
  if (d.includes('stikl')) return 'GLASS';
  if (d.includes('antrin')) return 'RECYCLABLE';
  if (d.includes('popier')) return 'PAPER';
  return null;
}

function wasteType(description, inventory, plural) {
  // Sources in strict order of trustworthiness. They must not be concatenated:
  // `descriptionPlural` is WRONG for some containers — measured 2026-08-03,
  // Gudobelių tak. 4 returns description "Žaliųjų atliekų" with plural
  // "mišrių atliekų". Joining the two strings and testing "mišri" first
  // reclassified 194 green containers as mixed while fixing 56 — a net loss
  // that the container counts alone would not have shown, since the total was
  // unchanged.
  //
  // 1. description — right almost everywhere, but sometimes a place name
  //    ("Kauno raj. MA" here, "Kaišiadorys" in Kaišiadorys)
  const fromDesc = typeFromText(description);
  if (fromDesc) return fromDesc;

  // 2. the inventory infix. Not every number carries the municipality prefix —
  //    Kauno m. writes "MA-000017" where Kauno r. writes "52-MK-036668", so
  //    taking part [1] lands on a serial number and leaves the whole
  //    municipality unclassified. Scan every alphabetic segment instead.
  for (const part of String(inventory || '').split('-')) {
    const t = INFIX_TYPE[part.trim().toUpperCase()];
    if (t) return t;
  }

  // 3. descriptionPlural, last: unreliable in general (see above), but it is
  //    the only signal left when description names a place AND the inventory
  //    number is blank — which is how Adolfo Šapokos g. 65 (hashedId eKP4RerK)
  //    kept its container, lost only its number, and dropped MIXED from the
  //    address entirely.
  return typeFromText(plural) || 'OTHER';
}

const slug = s => s.replace(/\s+/g, '-').replace(/[^\p{L}\p{N}-]/gu, '').toLowerCase();

async function main() {
  const all = await api('/schedule/getdistricts?search=');
  console.log(`Švara covers ${all.length} municipalities`);

  const districts = allRegions ? all
    : all.filter(d => regions.includes(d.district));
  if (!allRegions) {
    const missing = regions.filter(r => !all.some(d => d.district === r));
    if (missing.length) {
      // Throw rather than process.exit(): exiting from inside an async function
      // while a fetch handle is still open trips a libuv assertion, and the
      // process then reports 127 instead of 1 — a scope typo would look like a
      // missing interpreter. The catch at the bottom turns this into exit 1.
      console.error(`available: ${all.map(d => d.district).join(', ')}`);
      throw new Error(`not served by Švara: ${missing.join(', ')}`);
    }
    console.log(`fetching ${districts.length} in scope: ${regions.join(', ')}`);
    console.log('(--all fetches every municipality; --regions "A,B" overrides)');
  }
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
      const empty = [];
      for (const { subdistrict } of subs) {
        let subCount = 0;
        for (let page = 0; ; page++) {
          const r = await api('/schedule/getcontracts?' + q({
            region, subDistrict: subdistrict, city: '', address: '', houseNumber: '',
            search: '', pageSize: PAGE_SIZE, pageIndex: page,
          }));
          const got = (r.data || []).length;
          subCount += got;
          for (const c of r.data || []) {
            // A few rows come back with inventoryNumber === false rather than a string.
            // Keep them — the address and ids are still good — but never let a boolean
            // reach the catalogue, where downstream code calls .split() on it.
            const inv = typeof c.inventoryNumber === 'string' ? c.inventoryNumber : '';
            if (!c.fullAddress || !c.hashedId) continue;
            // wasteObjectId is what getschedule takes. hashedId does NOT work there
            // (measured: it returns an empty result under every parameter name), so
            // without this field the date fetch would need a second getcontracts call
            // per container — 57 091 extra requests for a value this response already
            // carries.
            entries.push([c.fullAddress, inv,
                          wasteType(c.description, inv, c.descriptionPlural),
                          c.hashedId, c.wasteObjectId ?? null]);
          }
          // Stop when a page comes back short, NOT when the response says it is
          // the last page. `totalPages` is no longer present in the response —
          // and `page + 1 >= (r.totalPages || 0)` reads an absent field as 0,
          // which is true on page 0, so every subdistrict silently stopped after
          // one page. Measured 2026-08-03: the Kauno r. catalogue fell from
          // 58 477 containers to 52 483 with no error and 24 of 26 subdistricts
          // byte-identical — Užliedžių truncated at exactly PAGE_SIZE (7 471 ->
          // 2 000) and Vandžiogalos vanished entirely (523 -> 0).
          //
          // A short page cannot be faked by a missing field: it is the data
          // itself. A full page always asks again, and the extra request at the
          // end of an exact multiple is the price of not trusting metadata that
          // has already disappeared once.
          if (got < PAGE_SIZE) break;
          if (page > MAX_PAGES) {
            throw new Error(`${subdistrict}: still returning full pages after ` +
              `${MAX_PAGES} — refusing to loop, the result would be incomplete`);
          }
        }
        // A genuinely empty subdistrict exists — Švara lists Šakių sen. and it
        // has had 0 containers in every catalogue — so this cannot be fatal on
        // its own. But an empty one is also how Vandžiogalos (523 containers)
        // disappeared silently, so it must be visible, and several at once means
        // the query shape broke rather than the countryside emptying.
        if (!subCount) empty.push(subdistrict);
        process.stdout.write(`\r  ${region}: ${entries.length} containers   `);
      }
      if (empty.length) {
        console.log(`\r  ${region}: ${empty.length} empty subdistrict(s): ` +
                    `${empty.join(', ')}          `);
        // One is normal (Šakių sen. has never had a container). Several at once
        // is the query breaking, and writing that file would delete real
        // addresses from the app.
        if (empty.length > 1) {
          throw new Error(`${empty.length} subdistricts returned 0 containers ` +
            `(${empty.join(', ')}) — refusing to write a catalogue that is ` +
            `probably truncated`);
        }
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
    process.exitCode = 1;      // see the note at the bottom of this file
  }
}

// Set exitCode rather than calling process.exit(): forcing an exit while a fetch
// handle is still open trips a libuv assertion on Windows and the process reports
// 127, which reads as "interpreter not found" rather than "this run failed".
// Setting the code lets Node drain its handles and exit 1 on its own.
main().catch(e => { console.error('FAILED:', e.message); process.exitCode = 1; });
