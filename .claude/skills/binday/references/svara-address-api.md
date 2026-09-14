# Švara — resolving addresses and fetching dates

Read this when a Švara fetch breaks or a new address must be resolved by hand.
`tools/fetch_svara.js` and `tools/fetch_dates_svara.mjs` already implement all of it.

## The server functions are seroval-encoded

`grafikai.svara.lt` is a TanStack Start SPA. The backend sits behind
`/_serverFn/<hash>?payload=…`. Plain JSON returns HTTP 500 `Seroval Error (step: 3)` — the
payload is **seroval**-encoded, and hand-writing that shape does not work. Use the library.

```js
import { toJSONAsync } from 'seroval';           // npm i seroval
const H = '540255adfb554d07c113b436aa5260c344d105f4d25780c646c3d51db39960be';
const node = await toJSONAsync({ data: { apiPath } });   // note the `data` wrapper
const r = await fetch(`https://grafikai.svara.lt/_serverFn/${H}?payload=` +
    encodeURIComponent(JSON.stringify(node)),
  { headers: { 'x-tsr-serverFn': 'true',
      accept: 'application/x-tss-framed, application/x-ndjson, application/json' } });
```

`H` is one server function that proxies every REST path; find it as a 64-char hex string in
`/assets/index-*.js`. Without the `{ data: … }` wrapper the call returns
`Cannot read properties of undefined (reading 'tenantId')`.

Endpoint templates live in the **routes chunk** (`/assets/routes-*.js`), not the main bundle:

```
/schedule/getsubdistricts?region=&search=
/schedule/getcities?region=&subDistrict=&search=
/schedule/getstreets?region=&subDistrict=&city=&search=
/schedule/getcontracts?region=&subDistrict=&city=&address=&houseNumber=&pageSize=&pageIndex=
/schedule/getschedule?wasteObjectId=
```

## `getschedule` takes `wasteObjectId`, not `hashedId`

This is the trap that reads as a normalisation problem. `getschedule` returns an **empty
result** for a `hashedId` under every parameter name — no error, no hint. `getcontracts`
returns both ids on every row, so carry both. The catalogue fetcher once discarded
`wasteObjectId`, which would have meant a second `getcontracts` per container: 57 091 extra
requests.

`getschedule` is otherwise the safe call in this chain: a nonexistent, zero, negative, empty
or *neighbouring* `wasteObjectId` returns an empty schedule, never another container's dates
(6/6 probes). All the risk is in `getcontracts`.

## `region`, not `district`

`getdistricts` returns rows keyed `district`, so passing `district=` to the next call reads
naturally — and returns HTTP 200 with 550 subdistricts from every municipality in the
country instead of the 26 in the one you asked for. No error, plausible data, wrong answer.
Sanity-check the row count against the municipality you asked for.

## Every `getcontracts` filter is `Contains`, not equality

Measured 2026-08-02:

| sent | returned |
|---|---|
| `houseNumber=8` | `8`, `8A`, `38`, `18` |
| `address=Žalgirio g.` + `houseNumber=8A`, no `city` | `Žalgirio g. 8A` in Juragiai **and** `Žalgirio g. 28A` in Ringaudai |
| `address=Saulės g.` + `houseNumber=5`, no `city` | 45 rows, **20 of them not house 5** (`15-1`, `35`, `15C`, `3-5`), spanning 16 localities |

`Saulės g. 3-5` matches because the *flat* contains a `5`.

- **Resolving one address: send all five fields** (`region`, `subDistrict`, `city`,
  `address`, `houseNumber`). With all five present, 103/103 probes returned exactly the
  requested locality.
- **Always read `fullAddress` back** and compare it to what you asked for. The filter cannot
  be trusted to have narrowed anything.
- Full-but-wrong fields are safe — a wrong `city` returns `totalRecords: 0`, never a
  substitute. Omitting `region` also returns 0.
- Paging is correct (`total=45` → 20+20+5, no duplicates); `pageSize=1000` returns all 45 at
  once, so paging can be skipped for single-address lookups.

## Bulk enumeration

Leave `city`/`address`/`houseNumber` empty and `getcontracts` returns every container in a
subdistrict, each row carrying `hashedId`, `fullAddress`, `inventoryNumber`, `frequency`,
`wasteObjectId` and `scheduleIds`. `subDistrict` is **mandatory** — without it
`totalRecords` is 0 rather than everything. `pageSize` up to 1000 works (~13 s per full
page).

Measured for `Kauno r. sav.`: 26 subdistricts, **58 477 containers**, ~13 min. Neither
operator rate-limits (measured across 200 + 58 477 + 266 requests), so the date fetch runs
8 concurrent and finishes in ~9 min.

Type mix in one fully-pulled subdistrict (Garliavos apylinkių, 5 384 rows): 3 827 mišrios,
1 138 "Kauno raj. MA", 400 žaliosios, 19 antrinės žaliavos — **no packaging or glass at
all.** Švara does not know about the Ekonovus containers at the same address, so the two
catalogues must be built separately; one cannot be derived from the other.

## Type comes from the infix, not always from `description`

Švara's `description` reads "Mišrios atliekos" in Kauno r. but "Kaišiadorys" — the town — in
Kaišiadorys. `fetch_svara.js` falls back to the inventory infix when the description does
not name a type. It also guards `inventoryNumber`, which arrives as boolean `false` on ~314
rows; those keep their address and `hashedId`.

**Container-type infixes differ per municipality.** Kaunas uses `MK`/`P`/`S`; Kaišiadorys
uses `KA`/`SA`/`RA`; blocks of flats use `PLV`/`PV`/`SV`. A Kaunas-only table left all
13 250 Kaišiadorys containers as `OTHER` — a grey dot instead of the bin's colour. Resolve
an unknown infix by **fetching one container's dates and reading the interval** (14 days
mixed, ~28–35 packaging, ~91 glass) rather than guessing from the letters. Kauno m. numbers
also omit the municipality prefix (`MA-000017`, not `52-MA-000017`), so read every segment
rather than a fixed position.

## The PDF and ICS endpoints, for a single known container

```bash
curl -s "https://grafikai.svara.lt/api/download/<hashedId>"           # PDF calendar
curl -s "https://grafikai.svara.lt/api/calendar/download/<hashedId>"  # ICS
```

Unauthenticated, instant. The PDF holds the full 12-month window; parse it with
`scripts/svara_from_pdf.py`. Verified against a browser scrape: 24/24 dates agreed.

The **ICS contains only the next pickup**, plus two 1970 daylight-saving artefacts any date
regex will happily return — useful for "when is the next one", useless for a full schedule.

Why the PDF needs a script: collection days are drawn as red rectangles *behind* the digits,
so `extract_text()` returns every day number with no indication of which are pickups. See
`operator-gotchas.md` for the two layout traps the script already handles.

## The browser fallback

```bash
bash scripts/scrape_svara.sh "Kauno r. sav." "Garliavos apylinkiu sen." "Juragiu k." "Zalgirio g." "8A"
```

Use when the API shape has changed or seroval is unavailable. **Read the calendar with
vision, not the DOM** — see `operator-gotchas.md`. Don't click the *Atsisiųsti PDF* buttons:
the download lands on the remote browser's filesystem where you cannot read it, and they hit
the same `/api/download/` endpoints you can `curl`.

Švara publishes a rolling ~12-month window — expect roughly 26–32 dates for a biweekly
container, some of them in the past.
