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
Ekonovus 40 localities 0 failures, 51 locality queries 0 failures, 103 Švara address+schedule
pairs 0 failures; timing recovers instantly after a burst). So no artificial delay, no
pacing. Retries are still needed for transport failures only.

#### Švara's filters are `Contains`, not equality — read the address back

`CLAUDE.md` warns that Ekonovus serves a valid-looking wrong answer. **Švara does too**, and
the mechanism is different: every `getcontracts` field is a substring match.

| Sent | Returned |
|---|---|
| `houseNumber=8` | `8`, `8A`, `38`, `18` |
| `address=Žalgirio g.`, `houseNumber=8A`, no city | `Žalgirio g. 8A` Juragiuose **and** `Žalgirio g. 28A` Ringauduose |
| `address=Saulės g.`, `houseNumber=5`, no city | 45 rows, **20 of them not house 5** (`15-1`, `35`, `15C`, `3-5`), across 16 localities |

`Saulės g. 3-5` matches because the *flat* contains `5`. So:

- **Always send all five fields** (`region`, `subDistrict`, `city`, `address`, `houseNumber`).
  With all five present, 103/103 probes returned the requested locality and 0 wrong rows.
- **Always verify the returned `fullAddress`** against what was asked before using the row.
  The filter cannot be trusted to have narrowed anything.
- Full-but-wrong fields are safe: a wrong `city` returns `totalRecords: 0`, never a
  substitute. Omitting `region` also returns 0.

`getschedule` is safe by contrast: a nonexistent, zero, negative, empty or *neighbouring*
`wasteObjectId` all return an empty schedule, never another container's dates (6/6 probes).
All risk in the Švara chain sits in `getcontracts`.

Paging works correctly — `total=45` is retrievable as 20+20+5 with no duplicates — and
`pageSize=1000` returns all 45 in one call, so paging can be avoided entirely.

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

Parses both operators into `(locality, street, house, flat)`. **All four are part of the
key.** Each component below is kept because dropping it was measured to produce wrong
dates, not merely fewer matches.

| Rule | Without it |
|---|---|
| House number must contain a digit | `Slėnio g.` parses as street `slėnio`, house `g.` |
| **Flat stays in the key** (`31-1` ≠ `31`) | see below — wrong schedules, not lost matches |
| Locality stem: drop type suffix, accents, case ending | `Antagynė` ≠ `Antagynės k.` |
| Full first name → initial | `Povilo Matulionio g.` ≠ `P. Matulionio g.` |
| `mst.`/`mstl.`, `skrg`/`skg`, `takas`/`tak` | operator-specific spellings |

**Locality must stay in the key — measured against real dates, not match rates.** Fetched
16 093 Ekonovus containers across 51 adversarially-chosen localities: of 1 442 street+house
keys present in two or more localities, **1 406 (97.5%) have different pickup dates**.
Švara agrees: of 12 such cases fetched, **12 (100%)** differ.

```
gėlių g. 1 [PACKAGING]     saulės g. 5 [MIXED, Švara]
  Akuotų k.     08-21        Didvyrių k.    06-10
  Dievogalos k. 08-18        Domeikavos k.  06-11
  Dubravų k.    08-07        Dubravų k.     06-12
```

Dropping locality does not fuse duplicates — it hands the user another village's schedule.
The earlier "51 collisions between Garliava and Zapyškis" understated this by two orders of
magnitude; the real figure for Kauno r. is 5 085 ambiguous street+house keys covering 46%
of all containers.

**The flat must stay in the key, and this reverses the previous rule.** "A container stands
at a building, not at a flat" is false in this data. Measured:

| | flats compared | share whose dates DIFFER |
|---|---|---|
| Švara (MIXED) | 20 buildings | **12 (60%)** |
| Ekonovus (GLASS/PACKAGING) | 969 building+type groups | 4 (0.4%) |

Every one of the 3 746 multi-flat buildings in the catalogue gives each flat its **own
container id** — 0 shared, at both operators. Most share a schedule; a minority do not:

```
Girininkų II k. Vėjo g. 12 [Švara MIXED]     Biruliškių k. Pastotės g. 7 [Ekonovus GLASS]
  flat 1: 80 dates — weekly                     flats 1,2,3,5,6: 5 dates/year
  flat 2: 40 dates — fortnightly                flat 4:         12 dates/year
```

Collapsing those to the building shows one neighbour the other's schedule, and the
resident misses more than half their pickups. Collapsing was also the single largest source
of apparent operator disagreement: it accounted for **14.0%** of the 500-address sample's
mismatches, against 1.4% genuine service split and **0.2%** true locality disagreement.
The "88.8% overlap ceiling" three sessions tried to raise was mostly this rule, not the
operators.

Keep a **building-level fallback** for lookup only, never for the key: 22 of 500 sampled
addresses exist at Švara as a building while Ekonovus splits them into flats, and 4 the
other way round.

### Stage 3: merge (pure function)

One entry per address, carrying every container from both operators.

**The 36 348 figure was computed with the flat collapsed and must be recomputed.** It is no
longer the acceptance target — keying on `(locality, street, house, flat)` necessarily
yields more entries, since 4 813 Švara and 10 373 Ekonovus rows carry a flat. Recompute it
in step 5 and record the new number; do not treat a change from 36 348 as a regression.

The one-operator entries are **not** a defect — they are the service split (Švara-only 92%
mixed waste, Ekonovus-only 78% packaging+glass), confirmed live on `Gabijos g.,
Akademijos mstl.`

What the merge must **not** do: fuse two entries because their waste streams happen to be
disjoint. That rule was considered and killed by measurement — it would wrongly fuse **255
locality pairs**, e.g. `Sauletekio g. 10` in Akademija (GREEN only) with the same street and
number in Domeikava (GLASS+MIXED+PACKAGING). Disjoint streams are not evidence of one
property.

### Stage 4: build (pure function, owns `dist/`)

Groups containers by identical date set. **Measured across 51 localities: 16 093 containers
collapse to 119 distinct schedules** — GLASS 68, PACKAGING 23, OTHER 23, MIXED 3, PAPER 2.
The Juragiai observation (335 → 2) holds at scale, so a schedule is stored once and every
address holds only a reference to it.

**A locality is not one schedule.** 106 (locality, waste-type) pairs carry more than one —
Domeikava and Ringaudai have 8 distinct glass schedules each. The reference must therefore
be per address+type, never derived from the locality.

```
dist/
  version.json          {built, areas: {"kauno-r-sav": "<sha>"}}
  areas.json            municipalities present, derived from disk
  kauno-r-sav/
    index.json          locality → streets → house numbers      (size: measure, see below)
    data.json           addresses → containers → schedule ids    (size: measure)
    schedules.json      schedule id → date list                  (~119 entries per area)
```

**The sizes are unmeasured.** The `0.06 MB` / `0.60 MB` figures in the first draft appear
nowhere in `DECISIONS.md`; a direct measurement of Švara's Kauno r. address strings alone
gzips to **0.14 MB**, already over the claimed full index. Measure and record the real
numbers at step 5 rather than carrying an estimate written as fact.

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

Three assertions added because a build can now pass the old checks while being wrong:

- **No key collapse.** No two addresses differing only by locality or by flat may share a
  schedule reference *unless their fetched date lists are byte-identical*. This is the check
  that would have caught the flat rule: it fails on `Vėjo g. 12-1` vs `12-2` (80 vs 40
  dates) and on `Saulės g. 5` across Didvyriai/Domeikava/Dubravai.
- **Locality-collision witness.** `Saulės g. 5` must resolve to ≥16 distinct addresses and
  they must not all carry the same schedule id. A build where they do has silently dropped
  locality from the key.
- **Flat witness.** `Biruliškių k. / Pastotės g. 7` must keep flats 1–6 as separate
  addresses, with flat 4 on a different glass schedule from the rest.

The 36 348 address count is **not** an assertion — it was computed under the old flat rule.
Record whatever the new key produces and assert only that it does not *fall* below the
previous build.

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
| 1 | Replace mutated `CONTAINERS` with `setActiveSchedule`/`getSchedule` | inject a temporary second schedule (see below) and switch between them; no `CONTAINERS.length = 0` remains |
| 2 | `raw/` + `dist/` layout, atomic writes, `.meta.json` | delete `dist/`, rebuild, identical output |
| 3 | Split `index.html`, add `build_app.py` (bumps `CACHE`) | behavioural checks above pass |
| 4 | Rewrite fetchers to write `raw/` only, never delete | interrupt mid-run, previous files intact |
| 5 | normalise + merge + build → `dist/` | Žalgirio 8A carries 3 streams; the three new collision assertions pass; record the address count and real gzip sizes |
| 6 | New `dist/` checker, wired as publish gate | break a file on purpose, publish aborts |
| 7 | Commit `dist/`, cache data files in `sw.js` | live `dist/areas.json` returns 200, not today's 404; works offline |
| 8 | Fetch dates and wire `a.schedule` (see below — this is not a wiring task) | saved address renders a schedule instead of "dar neįkeltos" |
| 9 | `version.json` revalidation | change a signature, app picks up new data next open |
| 10 | GitHub Actions monthly + cheap pre-check | scheduled run green; a second run does nothing |

**Step 1's obvious test cannot fail.** "The app behaves identically" is guaranteed no matter
what the refactor does, because the branch being changed is dead: `a.schedule` is written
nowhere, so `CONTAINERS.length = 0` never executes today. Verify it by hand-injecting a
second schedule into `saved.list[n].schedule` from the console and switching addresses —
otherwise step 1 ships unverified until step 8.

**Step 8 is the largest undecided design in this plan, not a wiring task.** Stages 1–4
produce container→schedule references; nothing yet fetches dates for every address. The two
options carry different costs, both measured:

| | cost | note |
|---|---|---|
| Ekonovus, per locality | ~7 s × 280 ≈ 35 min | measured; one query returns the whole locality |
| Švara, per container | 63 ms × 58 477 ≈ **61 min** | measured per call; no bulk equivalent found |

That 61 min figure follows from two numbers already in this plan but was never stated. The
in-app comment at `index.html:1332` still asserts the opposite — that bulk date fetching is
"far too slow" — which S3 disproved. Decide bulk-prebuilt-in-`dist/` versus on-demand
per saved address **before** starting step 8, and correct that comment either way.

Steps 1–3 touch no network and no operator data. Step 7 is what makes the deployed picker
work at all — today it 404s.

## Saved addresses must survive

`localStorage` key `binday.addresses` holds `{active, list: [{address, containers[]}]}`,
where `address` is Švara's full string. The merged list keys on
`(locality, street, house, flat)`, so stored entries will not match by construction.

Migrate rather than clear: on load, re-resolve each saved `address` through the new index and
replace it with the new key, keeping the user's order and active selection. An address that
fails to resolve stays in the list, marked, rather than disappearing silently — a user who
opens the app to find their addresses gone has no way to know why.

**A saved building-level address may now resolve to several flats.** Do not pick one: mark
the entry as needing re-selection and let the user choose, since the flats can carry
different schedules. Silently picking flat 1 is exactly the failure the flat key exists to
prevent.

Decide this before step 8; it is a one-way door for anyone already using the app.

---

## Open, and deliberately not decided here

- **How the UI presents flats.** Flats are now part of the key, so `31-1` and `31-2` are
  separate addresses with possibly different schedules. A user searching `Pastotės g. 7`
  must be shown the flats and pick one — showing the building alone is no longer an option,
  and picking a flat for them risks the 60% Švara case. Whether the search groups them under
  one expandable building row or lists them flat is a UI question; that they must be
  distinguishable is not.
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

## What the second pass corrected — measured against dates, not match rates

Same shape of error again, one level deeper: **a rule was trusted because it was written
down, and the number it produced was optimised instead of questioned.** Three sessions
chased an "88.8% overlap ceiling" that was mostly self-inflicted.

| Believed | Measured |
|---|---|
| "A container stands at a building, not at a flat" — flats collapse | **False.** All 3 746 multi-flat buildings give each flat its own container id. 60% of Švara multi-flat buildings have genuinely different dates per flat |
| Flat collapse costs only match rate (8–14%) | It accounted for **14.0 of the 17.8 percentage points** of apparent operator mismatch, and produces wrong schedules |
| Locality collisions: 51 between Garliava and Zapyškis | **5 085** ambiguous street+house keys in Kauno r., covering 46% of containers; 1 406 of 1 442 tested carry different dates |
| `DECISIONS.md` (line 155): "merge on street+house, locality is a display label" | **Rejected.** Would destroy 11 375 addresses and mix 46% of containers. The same file's other entry — locality required — is the correct one |
| "Merge when waste streams are disjoint" (considered this session) | **Rejected before writing.** Would wrongly fuse 255 locality pairs, e.g. Akademija GREEN with Domeikava GLASS+MIXED+PACKAGING |
| Only Ekonovus serves a plausible wrong answer | **Švara does too.** All `getcontracts` filters are `Contains`: `houseNumber=5` returns `15-1`, `35`, `3-5`; without a locality, 20 of 45 rows are the wrong house |
| Flats share dates, so the flat is noise (asserted mid-session from 4 containers in one town) | **Overturned by a wider sample.** True for Ekonovus (99.6%), false for Švara (40%) |
| `0.06 MB` / `0.60 MB` gzipped index sizes | Not in `DECISIONS.md` at all. Švara's address strings alone gzip to 0.14 MB |

The measurements in `DECISIONS.md` held up; the *rules* written alongside them did not. A
rule that loses matches looks like a tuning parameter; a rule that changes dates is a bug.
Test every key component against fetched dates, not against overlap percentages — the
overlap number cannot tell the two apart, which is why it survived three sessions.
