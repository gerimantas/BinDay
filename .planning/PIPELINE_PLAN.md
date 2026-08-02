# BinDay — pipeline and module split: implementation plan

Written 2026-08-02 (S3), after the address→container→dates chain was measured end to end.
Every number below is from a live measurement recorded in `DECISIONS.md`; nothing here is
an estimate unless it says so.

Scope: **Kauno r. sav.** Kaunas city is out — see `DECISIONS.md`.

## Current state of the deployed app — verified, and worse than assumed

A first draft of this plan treated multi-address as working and merely stale. It is not
working at all in production. Checked against the repo and the live site:

| Claim | Reality |
|---|---|
| The app serves a catalogue | `data/catalog/` is in `.gitignore`; `https://gerimantas.github.io/BinDay/data/catalog/areas.json` returns **404** |
| Data files are cached offline | `sw.js` `ASSETS` lists only `index.html`, the manifest and icons — no data file |
| Runtime fetches get cached | `cache.put` appears **nowhere**; the fetch handler returns `cached \|\| fetch(...)` and discards the response |
| Saved addresses show dates | `applyActive()` reads `a.schedule`, and **nothing ever writes it** — every saved address falls through to "Išvežimo datos šiam adresui dar neįkeltos" |

So the address picker in the deployed app cannot load a catalogue, and even locally it
resolves containers without ever reaching dates. The gap is not freshness — it is that the
feature has no data path at all.

This changes the ordering below: publishing `dist/` and wiring the app to it is not the last
step, it is what makes the existing UI function.

---

## The rule the whole design exists to enforce

Last session rebuilt the catalogue six times and lost `Kauno m. sav.` twice, because
`build_index.py` deleted files it did not create. The structural fix:

> **A step may only delete what it created. Fetch writes and never deletes; build owns its
> output directory entirely and can be wiped at any time.**

Everything below follows from that.

```
data/raw/     fetch writes here.  build never modifies it.  survives any failure.
dist/         build owns this.    delete it freely — one build restores it.
```

If `dist/` is destroyed it is rebuilt in seconds from `raw/`, with no network. If `raw/` is
destroyed the operators must be asked again. That asymmetry is why only fetch may touch it.

---

## Part 1 — the pipeline

### Stage 1: fetch (the only stage that touches the network)

Three independent fetchers, each writing whole files and never deleting:

| Fetcher | Unit of work | Measured cost |
|---|---|---|
| `fetch_svara_contracts` | one subdistrict | 58 477 containers, ~13 min |
| `fetch_svara_schedules` | one container | 63 ms — 200 back-to-back, 0 failures |
| `fetch_ekonovus` | one **locality** | ~7 s each → 280 localities ≈ 35 min |

**Ekonovus is fetched per locality, not per address or per date.** One request returns every
container in the locality with its dates:

```
StartsWith(WasteObject.Adresas, "<locality> ")
+ the template's Future / OverNextRun / Rodomas tvarkaraštis filters
Select: Adresas, Inventorinis nr., Datos (Measure)
```

Two traps, both already paid for:

- **`Datos` is a Measure, never a Column.** `ScheduleDates.Date` is an unrelated calendar
  table; joining through it yields a cross product that looks completely convincing —
  populated Sundays, plausible counts, wrong containers.
- **`InvalidUnconstrainedJoin` not firing does not mean the join is right.** `Adresas`+`Date`
  does not raise it and is exactly the query that fabricated results.

**No rate limiting exists at either operator** (measured: Švara 200 requests 0 failures,
Ekonovus 40 localities 0 failures, and timing recovers instantly after a burst). So no
artificial delay, no pacing. Retries are still needed for transport failures only.

#### Writing rules

- One file per unit: `raw/ekonovus/kauno-r-sav/juragiu-k.json`.
- Write to `.tmp`, `fsync`, then rename. An interrupted fetch leaves the previous file
  intact, never half of a new one.
- Alongside each file, `.meta.json`: `{fetched_at, source, request, sha256, count}`.
- **A missing new file is not a deleted old one.** If a locality fails, log it and move on;
  the previous file stays and the build uses it.
- Exit non-zero if any unit failed, so a scheduled run goes red — but only *after*
  attempting all of them.

### Stage 2: normalise (pure function, no network)

Parses both operators into `(locality, street, house)`. Rules, each earned from a real
mismatch:

| Rule | Without it |
|---|---|
| House number must contain a digit | `Slėnio g.` parses as street `slėnio`, house `g.` |
| Flat collapses to building (`31-1` → `31`) | loses 8–14% of matches |
| Locality stem: drop type suffix, accents, case ending | `Antagynė` ≠ `Antagynės k.` |
| Full first name → initial | `Povilo Matulionio g.` ≠ `P. Matulionio g.` |
| `mst.`/`mstl.`, `skrg`/`skg`, `takas`/`tak` | operator-specific spellings |

**Locality must stay in the key.** `Vytauto g. 85` exists in Garliavos m. *and* Zapyškio
mstl. — 51 collisions between that pair alone. Dropping locality raises the match rate to
90.9% by fusing houses 20 km apart.

### Stage 3: merge (pure function)

One entry per address, carrying every container from both operators.

Expected output, from the current catalogues: **36 348 addresses**, 32 317 at both
operators, 2 310 Švara-only, 1 721 Ekonovus-only. The one-operator entries are **not** a
defect — they are the service split (Švara-only 92% mixed waste, Ekonovus-only 78%
packaging+glass).

### Stage 4: build (pure function, owns `dist/`)

Groups containers by identical date set — in Juragiai 335 containers collapse to 2
schedules — then writes:

```
dist/
  version.json          {built, areas: {"kauno-r-sav": "<sha>"}}
  areas.json            municipalities present, derived from disk
  kauno-r-sav/
    index.json          locality → streets → house numbers      (0.06 MB gz)
    data.json           addresses → containers → schedule ids    (0.60 MB gz)
```

Rules:

- Build into `dist.tmp/`, rename at the end. Never a half-written `dist/`.
- **`areas.json` is derived from what is on disk**, never written ahead of the data.
  Today's `data/catalog/index.json` declares 22 areas of which 3 exist — an index that
  lies is worse than none, because every later step trusts it.
- Per-area signature in `version.json`, so a Prienai change does not force Kauno r. clients
  to re-download.

### Stage 5: check (runs before anything is published)

**A new checker against `dist/`, not an extension of `check_catalog.py`.** The existing one
is written against `data/catalog/` with `index.json` / `svara-index.json` / `areas.json`
hardcoded — a structure this plan replaces. Extending it would mean maintaining assertions
for two incompatible layouts at once. Keep it running against `data/catalog/` for as long as
that directory exists, and delete it with the directory.

What the new checker asserts, carrying over the parts that earned their place:

- witness locality per municipality (`Kauno r. sav.` contains no address saying "Kauno" —
  use `Garliavos`, `Juragių`)
- share of `OTHER` containers above a threshold → fail
- **known-address assertion**: `Juragių k. / Žalgirio g. / 8A` must carry
  `{MIXED, PACKAGING, GLASS}` and `52-S-24716` must still end at `2027-07-06`
- every file named in `dist/areas.json` exists in `dist/`
- **no address may lose containers versus the previous build** without an explicit override

A failing check must abort the publish, leaving the previous `dist/` live.

### Stage 6: publish

Commit `dist/` and push.

**`dist/` must be committed, unlike `data/catalog/`.** That directory is in `.gitignore`
because a partial `build_index.py` run could destroy it, so freezing it in git would freeze
a corrupted state. `dist/` inverts that: it is disposable, regenerated from immutable `raw/`,
and gated by stage 5 — so committing it is safe, and it is the only way GitHub Pages can
serve it. `raw/` stays out of git; it is fetch output, restored by re-fetching.

Size is not an obstacle: 0.06 MB gzipped for the address index, 0.60 MB for addresses plus
containers.

### Orchestration

GitHub Actions, monthly, verified working: both operators answer from a runner
(IP `172.208.13.80`, US), Ekonovus **faster** there than locally (0.6 s vs 9.4 s). The
existing `probe-operators.yml` becomes the health check.

Schedules are published months ahead — the app's own glass horizon is 2027-07-06 — so
monthly is ~30× the needed margin.

**A cheap pre-check first:** fetch one known container per municipality and compare with
`raw/`. Unchanged → stop, no full fetch. That turns most months into seconds.

---

## Part 2 — splitting `index.html`

`index.html` is 1 442 lines: CSS 18–526, JS 603–1440. It is one file **by decision** —
offline at the kerb, no build step. That decision is not being reversed; the file is being
split along seams that already exist in it, and reassembled by a build step that produces
the same single file.

### Why now

The data work adds an address index, a schedule lookup and a staleness check to a file
already holding four unrelated concerns. The seams are visible in the source today:

| Lines | Concern |
|---|---|
| 604–657 | data + constants (`ADDRESS`, `CONTAINERS`, weekday names) |
| 658–703 | date helpers (`isoLocal`, `parseISO`, `daysBetween`, `buildCalendar`) |
| 705–828 | render |
| 829–959 | ICS export (`icsEscape`, `fold`, `buildICS`, `downloadICS`) |
| 961–1113 | address search (`normalise`, `tokens`, `searchAddresses`, `exactness`) |
| 1114–1440 | settings UI (`renderSaved`, `fillAreas`, `doSearch`, `locate`, `applyActive`) |

### Target

```
src/
  index.html          markup only
  styles.css
  js/
    dates.js          isoLocal, parseISO, daysBetween, prettyDate, relativeLabel
    calendar.js       buildCalendar
    ics.js            icsEscape, fold, stamp, buildICS, downloadICS
    search.js         normalise, tokens, addressKey, searchAddresses, exactness
    catalog.js        getIndex, getArea, version check — new, replaces ad-hoc fetches
    storage.js        loadSaved, persist
    render.js         render, typeDots, shortAddress
    settings.js       the sheet: renderSaved, fillAreas, doSearch, locate, applyActive
    main.js           wiring only
tools/build_app.py    inlines everything into index.html at the repo root
```

`index.html` at the repo root stays the deployed artefact — generated, not edited.

### One thing must change before the split, not during it

`CONTAINERS` is a module-level `const` array that `applyActive()` **mutates in place**:

```js
CONTAINERS.length = 0;
CONTAINERS.push(...a.schedule);
```

It is read by `buildCalendar` (681), `render` (739, 810) and the ICS export. Inside one
script that works by accident of shared scope. Split into modules, each importing
`CONTAINERS` as a binding, and the mutation silently stops propagating — the app would keep
rendering the hardcoded Juragiai schedule while claiming to show another address.

So: **replace the global with an explicit `setActiveSchedule(list)` / `getSchedule()` pair
first**, as its own commit against the current single file, where it is verifiable. Only
then split.

(`a.schedule` is read at 1348 and **written nowhere** — the branch is dead today. Wiring it
is part of stage 6, not of the split.)

### Constraints that survive the split

- **Still one file when served.** `build_app.py` inlines CSS and JS in dependency order.
  No module loader, no CDN, no build step for the *user*.
- **`CACHE` in `sw.js` must be bumped on every deploy that changes `index.html`.** The
  worker is cache-first; without the bump installed clients serve the old schedule forever.
  Make `build_app.py` do it automatically — this is the single most common way a correct fix
  fails to reach the phone.
- **Data files must first be cached at all.** They are not today: `ASSETS` lists no data
  file and `cache.put` appears nowhere, so a runtime fetch is served from the network or not
  at all. Two separate changes, in order: (1) cache data files so the app works offline at
  the kerb, (2) revalidate them in the background so a corrected schedule arrives.
- `isoLocal()` never `toISOString()`; UTF-8 writes explicitly; keep `apple-touch-icon.png`.

### How the split is verified

**Not by byte-identical output.** Concatenation changes whitespace, and the repo stores
CRLF while the sources will be LF, so that test fails on the first run for reasons that do
not matter — and the temptation is then to weaken it.

Behavioural equivalence instead, each checkable:

- the hero answers with the same date and the same bins for the shipped address
- the exported `.ics` is identical to one exported before the split (dates, UIDs, both
  `VALARM`s)
- address search returns the same ordered hits for the same query
- `sw.js` `CACHE` differs from the previous build

---

## How the app detects a new build

The measured `304, 0 bytes, 0.13 s` was `curl`. **A service worker cannot act on that
directly** — a conditional request is resolved in the HTTP layer and the worker sees a
normal `200` from the browser's own cache. Revalidation has to be explicit:

1. Fetch `dist/version.json` with `cache: 'no-store'` — it is a few hundred bytes.
2. Compare the per-area signature with the one stored alongside the cached data.
3. Differ → fetch that area's files and `cache.put` them; same → do nothing.

Cheap enough to run once a day on open, and it never blocks rendering: the app paints from
cache first and swaps in new data only once it has arrived. With no signal, nothing happens
and the cached schedule stays correct.

Per-area signatures matter here — a Prienai change must not make Kauno r. clients
re-download.

## Sequence

Ordered so that each step is verifiable on its own, and so nothing is moved twice.

| # | Step | Verifiable by |
|---|---|---|
| 1 | Replace mutated `CONTAINERS` with `setActiveSchedule`/`getSchedule` | app behaves identically; no `CONTAINERS.length = 0` remains |
| 2 | `raw/` + `dist/` layout, atomic writes, `.meta.json` | delete `dist/`, rebuild, identical output |
| 3 | Split `index.html`, add `build_app.py` (bumps `CACHE`) | behavioural checks above pass |
| 4 | Rewrite fetchers to write `raw/` only, never delete | interrupt mid-run, previous files intact |
| 5 | normalise + merge + build → `dist/` | 36 348 addresses; Žalgirio 8A carries 3 streams |
| 6 | New `dist/` checker, wired as publish gate | break a file on purpose, publish aborts |
| 7 | Commit `dist/`, cache data files in `sw.js` | live `dist/areas.json` returns 200, not today's 404; works offline |
| 8 | Wire `a.schedule` so a saved address shows dates | saved address renders a schedule instead of "dar neįkeltos" |
| 9 | `version.json` revalidation | change a signature, app picks up new data next open |
| 10 | GitHub Actions monthly + cheap pre-check | scheduled run green; a second run does nothing |

Steps 1–3 touch no network and no operator data. Step 7 is what makes the deployed picker
work at all — today it 404s.

## Saved addresses must survive

`localStorage` key `binday.addresses` holds `{active, list: [{address, containers[]}]}`,
where `address` is Švara's full string. The merged list keys on
`(locality, street, house)`, so stored entries will not match by construction.

Migrate rather than clear: on load, re-resolve each saved `address` through the new index and
replace it with the new key, keeping the user's order and active selection. An address that
fails to resolve stays in the list, marked, rather than disappearing silently — a user who
opens the app to find their addresses gone has no way to know why.

Decide this before step 8; it is a one-way door for anyone already using the app.

---

## Open, and deliberately not decided here

- **Which flat-level detail the UI shows.** Flats collapse to the building for matching;
  whether the app displays `31-1` or `31` is a UI question.
- **What happens when a municipality other than Kauno r. is selected.** The pipeline
  supports any, the data does not exist yet. Today the app's own text promises the opposite —
  `fillDataInfo()` says other municipalities are "ruošiamos", and `areas.json` ships a
  `pending` list. That copy has to match whatever is decided.
- **`X-PowerBI-ResourceKey` rotation.** It is the only credential and is read from a public
  embed URL. If it changes, fetch fails loudly, `raw/` is untouched and the app keeps
  serving the last good build — which is the correct failure mode, but nothing detects the
  rotation itself.

## What this plan corrected in its own first draft

Recorded because each error was the same shape: **assuming a mechanism already worked
because it was written down somewhere.**

| First draft said | Verification found |
|---|---|
| Data files need *different* cache behaviour | They have *no* cache behaviour — absent from `ASSETS`, no `cache.put` |
| The app serves a catalogue that goes stale | `data/catalog/` is gitignored; the live URL 404s |
| Extend `check_catalog.py` | It targets a directory layout this plan removes |
| Background revalidation "via `ETag`" | A service worker cannot see a 304; needs explicit `version.json` comparison |
| Split verified by byte-identical output | Impossible across CRLF/LF and whitespace; use behavioural equivalence |
| Split is safe to do first | Not until `CONTAINERS` stops being mutated in place |

The measurements in `DECISIONS.md` held up; the assumptions about the app's own code did
not. Check the code, not the note about the code.
