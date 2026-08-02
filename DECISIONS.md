# BinDay — Decisions

Architectural decisions and what was rejected, with the reasoning. Newest first.

## 2026-08-02 (S4) — The merge key is (locality, street, house, FLAT). Two earlier entries are superseded

Measured against **fetched pickup dates**, not against match rates. That distinction is the
whole finding: an overlap percentage cannot tell a lost duplicate from a wrong schedule, so
optimising it kept three sessions busy on a rule that was itself the defect.

Data: 16 093 Ekonovus containers across 51 adversarially-selected localities, plus 103 Švara
address→schedule pairs, plus direct API probes. Selection was deliberately biased toward
multi-flat buildings, locality disagreements and street+house collisions — a uniform sample
hides all three.

### This supersedes: "merge on street+house, locality is a display label only"

The entry *"2026-08-02 — Address list comes from the operator catalogues"* ends with:

> **Consequence for the UI:** locality cannot be treated as a reliable key across operators.
> Merge on street+house within a municipality, and keep locality as a display label only.

**That conclusion is wrong and must not be acted on.** It was drawn from a normalisation
statistic (ignoring locality raises overlap 88.8% → 90.9%) without checking what the fused
addresses actually collect.

| | |
|---|---|
| street+house keys existing in >1 locality (Kauno r.) | **5 085** (20.9% of all) |
| containers behind them | **60 966 of 132 260 (46.1%)** |
| addresses destroyed by dropping locality | **11 375** |
| of 1 442 tested, share with **different dates** per locality | **1 406 (97.5%)** |
| Švara MIXED, same test | **12 of 12 (100%)** |

```
gėlių g. 1 [PACKAGING]        saulės g. 5 [MIXED, Švara]
  Akuotų k.      08-21          Didvyrių k.     06-10
  Dievogalos k.  08-18          Domeikavos k.   06-11
  Dubravų k.     08-07          Dubravų k.      06-12
```

The 2.1% overlap gain was not duplicates merging — it was houses 20 km apart being handed
each other's schedules. The other entry in this file, *"the merge key is (locality, street,
house), all three required"*, is the correct one; its cited evidence (51 Vytauto g.
collisions between Garliava and Zapyškis) understated the real figure by two orders of
magnitude.

### This supersedes: "a container stands at a building, not at a flat"

Recorded twice — *"Flat numbers collapse into the building on purpose"* and *"Collapse flat
numbers to the building (`31-1` → `31`) — worth 8–14%, loses nothing"*. **It loses schedules.**

Every one of the **3 746** multi-flat buildings in the catalogue gives each flat its **own
container id** — 0 shared, at both operators. Most flats share a schedule; a minority do not:

| operator | multi-flat groups compared | dates DIFFER between flats |
|---|---|---|
| Švara (MIXED) | 20 buildings | **12 (60%)** |
| Ekonovus (GLASS/PACKAGING) | 969 building+type groups | 4 (0.4%) |

```
Girininkų II k. Vėjo g. 12 [Švara]      Biruliškių k. Pastotės g. 7 [Ekonovus GLASS]
  flat 1: 80 dates — weekly               flats 1,2,3,5,6: 5 dates/year
  flat 2: 40 dates — fortnightly          flat 4:         12 dates/year
```

Collapsing shows a resident their neighbour's schedule; in the Pastotės case they would miss
more than half their pickups. Keep a building-level **fallback for lookup only** — 22 of 500
sampled addresses exist at Švara as a building while Ekonovus splits them into flats, and 4
the reverse.

**The flat rule was also the main source of the "88.8% ceiling"** three sessions tried to
raise. Decomposing the mismatch in a 500-address sample:

| source | share | affects dates? |
|---|---|---|
| flat dropped (our own rule) | **14.0%** | no — but produces wrong container/schedule |
| genuine service split | 3.6% | yes |
| operator disagreement about locality | **0.2%** | yes |
| street spelling | 0.2% | yes |

Real operator incompatibility is ~0.2% — one address in 500. The rest we created.

### Rejected before implementing: "merge two entries when their waste streams are disjoint"

Proposed this session to recover the ~44 addresses where operators genuinely disagree about
the locality (`Jonučių k.` vs `Garliavos m.`). **Measured: it would wrongly fuse 255 locality
pairs**, e.g. `Saulėtekio g. 10` in Akademija (GREEN only) with the same street and number in
Domeikava (GLASS+MIXED+PACKAGING). Disjoint streams mean "one side only has a green bin", not
"same property". Those ~44 stay unmatched; that is the honest answer.

### Švara also serves a plausible wrong answer — `getcontracts` filters are `Contains`

`CLAUDE.md` warns about Ekonovus. Švara has the same class of trap by a different mechanism:
**every `getcontracts` field is a substring match, not equality.**

| sent | returned |
|---|---|
| `houseNumber=8` | `8`, `8A`, `38`, `18` |
| `Žalgirio g.` + `8A`, no `city` | `Žalgirio g. 8A` Juragiuose **and** `Žalgirio g. 28A` Ringauduose |
| `Saulės g.` + `5`, no `city` | 45 rows, **20 not house 5** (`15-1`, `35`, `15C`, `3-5`), 16 localities |

`Saulės g. 3-5` matches because the *flat* contains `5`. Rules that follow:

- **Send all five fields.** With `region`+`subDistrict`+`city`+`address`+`houseNumber` all
  present: 103/103 probes returned the requested locality, 0 wrong rows.
- **Verify the returned `fullAddress`** before using a row. The filter cannot be trusted to
  have narrowed anything.
- Full-but-wrong fields are safe: a wrong `city` returns `totalRecords: 0`, never a
  substitute. Omitting `region` also returns 0.

**`getschedule` is safe**: nonexistent, zero, negative, empty, and *neighbouring*
`wasteObjectId` all return an empty schedule, never another container's dates (6/6). All risk
in the Švara chain is in `getcontracts`. Paging is correct (45 = 20+20+5, no duplicates) and
`pageSize=1000` returns all 45 at once, so paging can be skipped.

### Schedules are a small shared set; a locality is not one schedule

16 093 containers → **119 distinct date sets**: GLASS 68, PACKAGING 23, OTHER 23, MIXED 3,
PAPER 2. The Juragiai observation (335 containers → 2 schedules) holds at scale, so a
schedule is stored once and addresses reference it.

But **106 (locality, waste-type) pairs carry more than one schedule** — Domeikava and
Ringaudai have 8 distinct glass schedules each. The reference must be per address+type; it
cannot be derived from the locality.

### Also corrected

- **36 348 addresses** was computed with the flat collapsed. It is no longer an acceptance
  target — the new key necessarily yields more (4 813 Švara + 10 373 Ekonovus rows carry a
  flat). Recompute and record; do not treat the change as a regression.
- **`0.06 MB` / `0.60 MB` gzipped index sizes** appear nowhere in this file despite being
  stated as measured in the plan. Švara's Kauno r. address strings *alone* gzip to 0.14 MB.
  Measure before quoting.
- **Mid-session self-correction:** from 4 containers in one town I concluded "flats share
  dates, so the flat is noise for scheduling". A wider sample overturned it — true for
  Ekonovus (99.6%), false for Švara (40%). Recorded because it is the same error as the
  original flat rule: a small convenient sample generalised into a rule.

## 2026-08-02 — Neither operator rate-limits; Ekonovus slows per query size, not per request rate

Tested before writing the refresh, because a hidden limit would make a scheduled build
unreliable in a way that only shows up in production.

**Švara: no limit found.** 200 `getschedule` calls back to back, no delay: **200 ok, 0
failures, 12.6 s total, 63 ms average.** Response time *fell* over the run (first ten 68 ms,
last ten 48 ms) — the opposite of throttling.

**Ekonovus: no failures either**, but 40 consecutive locality queries showed timing rise
from ~0.5 s to a stable ~10 s: 40 ok, 0 failures, 52 894 rows, 285.7 s. No `429`, no `503`,
no `Retry-After`, no rate-limit headers.

That looked like throttling and is not. A recovery test settled it — the same locality
(`Juragių k.`, 335 rows) immediately after the hammer run, after 60 s idle, after a further
120 s, and paced at one request per 5 s:

| Phase | Times |
|---|---|
| immediately after hammering | 0.49 s, 0.22 s |
| after 60 s idle | 0.32 s, 0.23 s |
| after 120 s more | 0.56 s, 0.37 s, 0.26 s |
| paced 1 req / 5 s | 0.23–0.61 s |

**Fast immediately, with no cool-down.** A throttle would have punished the first request
after the burst hardest; this one was 0.49 s. The slow queries were the *larger, less
common* localities further down the list, and the cheap repeated one stayed cheap
throughout. Cost tracks the query, not the client's recent history — and warm results are
cached server-side.

**Consequence for the pipeline:** no artificial delay is needed, and pacing buys nothing.
Fetch may run at full speed. Budget on measurement rather than the best case: 285.7 s for 40
localities ≈ **7 s each**, so all 280 Kauno r. localities ≈ **35 min**, matching the earlier
estimate. Retries should still exist for transport failures, but there is no limit to back
off from.

## 2026-08-02 — Scope is Kauno r. sav. only; Kaunas city is a different product

Every measurement in this session is Kauno r. sav. Kaunas **city** is deliberately out of
scope, and not merely postponed for capacity reasons — its data answers a different question.

- **Ekonovus does not serve it at all.** `ekonovus-52.json` contains zero `Kauno m.`
  addresses; code 52 is the district only. There is nothing to merge there, so the whole
  two-operator merge does not apply.
- **The containers are communal, not per-house.** Švara returns 4 169 containers at just
  1 580 addresses for a city of ~300 000 — verified live against `getcontracts`, matching
  `svara-index.json` exactly. 79% are `Antrinės žaliavos`; mixed waste is only 667
  containers at 476 addresses. Individual addresses carry up to 26 containers
  (`J. Borutos g. 23`), which is a block courtyard, not a house.

So a flat dweller searching their own address would not find their bin. The right question
in the city is "where is my courtyard point", which these records answer only partly — the
same pattern as allotment villages, at city scale.

Kauno r. keeps the property that makes the chain work: one address, one household, its own
containers.

## 2026-08-02 — `data/catalog/index.json` is not trustworthy; 19 of 22 files it lists are absent

`index.json` declares 22 Ekonovus areas; only 3 exist on disk. `svara-index.json` declares
`svara-kauno-m-sav.json` (4 169 containers) which is also absent, while the data itself is
still live — a fresh query returned exactly 4 169.

This is the failure `CONTEXT.md` names: `build_index.py` deletes files, so a run against a
partial catalogue destroys municipalities and then writes an index asserting they exist. An
index that claims files which are not there is worse than no index, because every later step
trusts it.

Consequence for the rebuild: **the index must be derived from what is on disk at build
time**, never written ahead of the data, and the fetch step must never delete.

## 2026-08-02 — Merge key is locality+street+house; 88.9% overlap is the correct answer, not a defect

One address is one entry, and it carries every container found at it from both operators.
The merge key is `(locality, street, house)`, each part normalised, **all three required**.

**Locality cannot be dropped from the key**, even though the operators disagree about it.
`Vytauto g. 85` exists in Garliavos m. *and* in Zapyškio mstl. — 51 street+house pairs
collide between those two localities alone. Matching on street+house only would fuse houses
20 km apart and hand the user someone else's schedule.

Locality names are unified by a stem that strips the type suffix (`k.`, `mstl.`, `m.`),
strips accents and drops the case ending, so `Antagynė` = `Antagynės k.`,
`Romainių kaimelė` = `Romainių kaimelės k.`, `Kačerginės mstl.` = `Kačerginės k.`. That
matches 266 of Ekonovus's 267 locality stems.

**The remaining 11% is not a normalisation failure — it is the service split**, and this is
the finding that closes the question. Addresses present at only one operator are almost
entirely single-stream:

| | share | streams |
|---|---|---|
| Švara-only (2 310) | 92% | `MIXED` (plus `GREEN`) |
| Ekonovus-only (1 721) | 78% | `PACKAGING` + `GLASS` |

Confirmed live: on `Gabijos g., Akademijos mstl.` Švara serves houses 1, 2, 25, 39 with
mixed waste, while Ekonovus serves 11, 13, 15, 17 with packaging and glass. Different
houses, different contracts — not two spellings of one address. Normalising locality names
moved the overlap by only 0.1% (88.8% → 88.9%), which is the evidence that no rule remains
to be written.

Final merged list for Kauno r.: **36 348 addresses** — 32 317 at both operators, 2 310 Švara
only, 1 721 Ekonovus only.

**Flat numbers collapse into the building on purpose**, so `Medeinos g. 32`, `32-1` and
`32-2` become one entry holding all their containers. 3 340 addresses merge this way; they
are the intended result, not label conflicts.

> **SUPERSEDED 2026-08-02 (S4).** All 3 746 multi-flat buildings give each flat its *own*
> container id, at both operators. 60% of Švara multi-flat buildings have different dates per
> flat (Ekonovus 0.4%) — e.g. `Vėjo g. 12` flat 1 weekly vs flat 2 fortnightly. Those 3 340
> "intended" merges hand residents their neighbour's schedule. Flat stays in the key; keep a
> building-level fallback for lookup only. See the S4 entry at the top.

## 2026-08-02 — The address list comes from the operator catalogues; the register is not used

Address search is built by merging the two operator catalogues directly. The RC Address
Register is dropped from the chain.

**Why the register turned out to be the wrong source.** A container is a property of a
*contract*, not of an address, so the register cannot answer whether one exists. Measured
on Kauno r.: of 76 739 register addresses (house level, flats excluded), **53.7% have no
container at either operator**. That is not a data gap — Švara's live API returns
`totalRecords: 0` for those addresses, and the pattern matches allotment areas
(Gervėnupio k. has 2 000 register addresses against 523 Ekonovus and 302 Švara containers;
147 streets named `Sodininkų g.`, `Lakštučių g.` in one village). Those plots share communal
containers rather than having their own.

Searching the register therefore forces the app to answer "not found" for half of all
addresses. Searching the merged catalogues makes that answer impossible: **the list contains
only addresses that have a container**, so the user cannot pick one that does not.

Merged result for Kauno r.:

| | |
|---|---|
| distinct addresses | 36 552 |
| localities / streets | 343 / 4 397 |
| carry all three main streams (MIXED+PACKAGING+GLASS) | 27 950 (76.5%) |
| present at both operators | 88.8% |

Verified on the app's own address: `juragių k. / žalgirio g. / 8a` →
`{MIXED, PACKAGING, GLASS}`, both operators — matching `CONTAINERS` exactly.

**Normalisation between the two operators** is still needed, since Švara writes
`Žalgirio g. 8A, Juragių k., …` and Ekonovus `Juragių k. Žalgirio g. 8A`. Rules that earned
measurable gains: require a **digit** in the house number (without it `Slėnio g.` parses as
street `slėnio` + house `g.`), unify `mst.`/`mstl.`, `skrg`/`skg`, `takas`/`tak`, and
collapse a full first name to an initial.

Normalisation stops paying at **88.8%** overlap. The residue is not spelling:
**the two operators disagree about which locality a street belongs to** — `Žiedo tak.` is
`Kuro k.` for Švara and `Altoniškių k.` for Ekonovus. Matching on street+house while
ignoring locality raises the overlap to 90.9% and explains 34% of Švara-only and 46% of
Ekonovus-only entries. The rest are genuine: each operator serves houses the other does not.

**Consequence for the UI:** locality cannot be treated as a reliable key across operators.
Merge on street+house within a municipality, and keep locality as a display label only.

> **SUPERSEDED 2026-08-02 (S4) — do not act on the paragraph above.** Merging on street+house
> destroys 11 375 Kauno r. addresses and mixes 46% of all containers: 1 406 of 1 442 tested
> street+house keys have *different pickup dates* per locality (Švara: 12 of 12). The 90.9%
> figure counted houses 20 km apart as matches. Locality stays in the key. See the S4 entry
> at the top of this file.

## 2026-08-02 — Address ↔ container is joined on text; there is no shared key

Verified, not assumed: **neither operator carries any Address Register identifier.** A full
Švara `getcontracts` row exposes `wasteObjectId`, `hashedId`, `dumpsterId`, `scheduleIds`
and `id` — all internal to the operator — and holds the address only as free text split
across `city` / `street` / `house`. No `AOB_KODAS`, no postcode. So the middle link of the
chain must be a text match, and its accuracy is a measured property of the pipeline rather
than something that can be engineered away.

Measured on Kauno r. against the register, with normalisation:

| Operator | parsed | exact | + flat collapsed | total | unmatched |
|---|---|---|---|---|---|
| Ekonovus | 75 655 (99.1%) | 85.2% | 13.8% | **99.0%** | 1.0% |
| Švara | 57 961 (99.1%) | 90.2% | 8.3% | **98.5%** | 1.5% |

Four normalisation rules earn this, and each was derived from real misses:

1. **Collapse flat numbers to the building** (`31-1` → `31`) — worth 8–14%, loses nothing,
   because a container stands at a building, not a flat.
   > **SUPERSEDED 2026-08-02 (S4): it does lose something — the schedule.** Each flat has its
   > own container at both operators, and 60% of Švara multi-flat buildings have different
   > dates per flat. This rule also produced 14.0 of the 17.8 percentage points of apparent
   > operator mismatch that later sessions tried to normalise away. See the S4 entry at the top.
2. **Collapse a full first name to an initial** (`Povilo Matulionio g.` →
   `p. matulionio g.`) — the register stores 111 Kauno r. streets with an initial while
   Ekonovus writes the name out.
3. **`mst.` → `mstl.`** — Ekonovus abbreviates the locality suffix differently.
4. **Match against both the raw and the normalised street form**, so normalisation can only
   add matches, never remove one that already worked.

The residual ~1% is genuine divergence, not a rule waiting to be written: streets absent
from the register (`Varžupio 2-oji g.`, `Ryto skrg.`), addresses with no street at all in
small villages, and operator typos (`L.Valionio`). Chasing it with fuzzy matching would
trade a known small gap for an unknown wrong-answer rate.

## 2026-08-02 — Rejected: Švara's `scheduleIds` as the schedule grouping key

`getcontracts` returns `scheduleIds` (e.g. `[3904]`) alongside the always-zero `scheduleId`,
and it looks like the operator's own grouping — 154 of 165 Juragiai containers share
`[3904]`. It is a **route** identifier, not a schedule: containers inside one id do not
share one date set. Sampled within `[3922]`, three distinct date sets appeared, differing
in real pickups (`2026-07-22` versus `2026-08-04`), and `[3904]` held two.

Dates must therefore be fetched per container. Grouping by the resulting date set is still
worth doing, but only to compress the built file after the dates are known — never to avoid
fetching them.

## 2026-08-02 — Ekonovus dates are fetched per locality, not per address or per date

Dates come from one query per locality: `StartsWith(WasteObject.Adresas, "<locality> ")`
plus the template's existing `Future`/`OverNextRun`/`Rodomas tvarkaraštis` filters,
selecting `Adresas` + `Inventorinis nr.` + the `Datos` **measure**.

Measured on `Juragių k.`: **335 containers with full date lists in 9.3 s cold, 0.6 s warm**,
one request, no paging. Verified against `CONTAINERS`: `52-P-22781` and `52-S-24716` return
exactly the dates already in the app, including the glass horizon `2027-07-06`.

**Why not per address** (the previous approach): ~7 s per address, and Garliava proved one
sample per locality is not enough, which implied walking 5 888 streets ≈ 11 h per
municipality.

**Why not per date:** see the rejected entry below — that path does not exist.

**Grouping is derived from the date sets, and it is strong.** In Juragiai, 333 of 335
containers fall into just 2 groups (Pakuotė ×166, Stiklas ×167); 2 outliers have their own
schedule. So a locality's schedule can be stored once per group rather than per container.
The group key must include the waste type — the same address has different groupings per
stream.

## 2026-08-02 — Rejected: querying Ekonovus by date to get "who is served today"

`ScheduleDates.Date` is a **plain calendar table** — 3 036 rows, 2016-12-26 → 2030-05-19,
~365 per year — with no relationship to any container. Filtering by it and selecting
`Adresas` returns a cross product, not a day's route.

It looks convincing and is wrong: every date came back populated, Sundays included, and
counts always hit the 30 000 window. The cross-check that killed it: container
`75-P-04773` appeared under `2026-08-02`, but its own schedule is
`2026-08-30, 09-27, 10-25…` — that date is absent, as it is for all 15 containers at
that address.

Power BI states the constraint directly when the fields cannot be joined:
`InvalidUnconstrainedJoin` — *"Not showing data for DataShape 'DS0' because it's not clear
how these fields are related."* Both `Teritorija`+`Date` and `Inventorinis nr.`+`Date`
raise it. **The absence of that error is not proof of a correct join** — `Adresas`+`Date`
does not raise it, and is exactly the query that produced fabricated results.

**Always reach dates through the `Datos` measure**, which carries the relationship, never
through the `Date` column.

`Teritorijos konteinerių tvarkaraščiams.Teritorija` (169 routes nationally, e.g.
`Kauno raj. mėlyni`) does join correctly via the measure, but is too coarse — a territory
covers most working days, and the whole-territory query takes 41 s and overflows the window.
Locality is the right granularity.

## 2026-08-02 — Švara schedules come from `getschedule`, as JSON, not from the PDF

`/schedule/getschedule` requires **`tenantId: 'svara'` in the payload** alongside `apiPath`,
and takes `wasteObjectId` (from a `getcontracts` row), not `hashedId`:

    /schedule/getschedule?wasteObjectId=279722&address=-&subDistrict=-&region=-&houseNumber=-&pageSize=10&pageIndex=0

It returns `[{date, year, month, day, dateFmt, weekDay}]` — about **60 ms per container**,
25 fetched in 1.5 s. The off-cycle Wednesday `2026-07-22` that `CLAUDE.md` documents is
present, so this path reproduces the PDF's deviations rather than smoothing them.

**Why this was missed before:** without `tenantId` the server answers `200` with
`result: []` instead of an error, so every probe looked like an empty schedule rather than a
malformed request.

`scheduleId` on the contract row is **always `0`** and cannot be used for grouping; group by
the date set instead, as with Ekonovus.

## 2026-08-02 — Address search comes from the RC Address Register, not the operator catalogues

Address lookup becomes its own layer, built from the state Address Register (Registrų
centras open data, CC BY 4.0, no auth, refreshed 2026-07-02). The operator catalogues stop
being the search index and answer only "who serves this address".

Files, all from `registrucentras.lt/aduomenys/?byla=…`, the same pattern already documented
for cadastral parcels:

| File | Size | Content |
|---|---|---|
| `adr_stat_lr.csv` | 57 MB | every address: `AOB_KODAS`, `NR`, `KORPUSO_NR`, postcode |
| `adr_gra_gatves.json` | 49 MB | 60 339 streets with names |
| `adr_gra_gyvenamosios_vietoves.json` | 191 MB | 20 840 residential areas |
| `adr_gra_adresai_LT.zip` | 62 MB | address points, WGS84, for geolocation |

Verified end to end on the app's own address: `Juragių k.` (`GYV_KODAS` 16583) → `Žalgirio
g.` (`GAT_KODAS` 1194157) → `NR` 8A → `AOB_KODAS` 184704894, which resolves in Švara's
catalogue to `52-MK-036668` — the MIXED container already in `CONTAINERS`.

**Why this beats searching the operator catalogues:** the register covers every address in
Lithuania, so a lookup never fails just because a catalogue build dropped a municipality.
The app can then say "this address is served by nobody we cover", which is a correct
answer it currently cannot give.

**Measured match rate**, register → Švara, all 58 477 Kauno r. entries: 88.0% exact, plus
8.0% when a flat number (`31-1`) collapses to its building (`31`), for **96.0% with no
fuzzy matching**. The remaining 3.1% unmatched and 0.9% unparsed are abbreviation noise
(`skrg.` vs `skg.`, `Suopių g 16` missing its full stop) — a normalisation problem, not an
architectural one.

**Flat numbers are dropped deliberately.** A container stands at a building, not at a flat,
so street + house number is the whole key. This is what earns the 8%.

> **SUPERSEDED 2026-08-02 (S4).** The premise is false in this data: every multi-flat building
> gives each flat its own container id, and 60% of Švara multi-flat buildings have different
> dates per flat. The key is `(locality, street, house, flat)` — all four. See the S4 entry at
> the top.

**The user picks a municipality first, then types a street.** The register is far too large
to ship whole (57 MB CSV alone); one municipality compresses to roughly 1–2 MB, matching how
the operator catalogues are already split.

## 2026-08-02 — Rejected: `govlt/national-boundaries-api` as a hosted service

The official state API (MIT, CC BY 4.0 data, OpenAPI, address search endpoints) looks like
the obvious answer and is not usable as a service: **there is no public instance.**
`boundaries-openapi.govstartup.lt` serves only ReDoc documentation — every path returns the
docs HTML, and POST is refused by Cloudflare with a 405 carrying `Content-Length: 0`, so the
application is never reached. The README documents self-hosting only.

Its 1.6 GB SQLite release is still useful as a pointer: `create-database.sh` names the exact
upstream RC files, which is where the URLs above came from. Self-hosting it would mean
running a server, which the project has already rejected.

## 2026-08-01 — Ship all municipalities, one catalogue file each

Both operator catalogues will be built for every municipality they cover, and published as
one JSON file per municipality rather than a single national file.

**Why all municipalities rather than Kaunas first:** collection is already automated and
cheap — the full Ekonovus enumeration is 410 059 containers across 22 municipalities in
199 s. Restricting to Kaunas would save nothing and would limit the app for no reason.

**Why split per municipality:** the full Ekonovus catalogue is ~20.5 MB raw / ~5 MB
gzipped. Downloading that on a phone at the kerb is unacceptable. One municipality is
roughly 1 MB, fetched once and then cached.

Coverage is **not national**: Švara serves 9 municipalities (Vilnius m., Kaunas m., Kaunas
r., Alytus m./r., Druskininkai, Kaišiadorys r., Prienai r., Birštonas) and Ekonovus 22.
Lithuania has 60. The app must say "your area is not covered" rather than show an empty
schedule.

## 2026-08-01 — No backend; static JSON on GitHub Pages

Rejected a Cloudflare Worker proxy after prototyping and proving it works (593 ms,
CORS verified in a real browser).

**Why rejected:** the Worker's only job would have been adding CORS headers, and GitHub
Pages already sends `Access-Control-Allow-Origin: *` — verified in a real browser against a
blocked direct fetch to Švara. Schedules change roughly once a year, so nothing needs to be
fetched live.

Parsing stays in Python, run by a scheduled job, because the Švara PDF parser is verified
(24/24 dates) and a JavaScript reimplementation produced wrong dates on the first attempt
(an impossible `2028-05-04` from the month-grid trap).

## 2026-08-01 — Catalogues built per operator, never derived from each other

Švara's Kauno r. data contains no packaging or glass at all — 5384 rows in one subdistrict
were mišrios, "Kauno raj. MA", žaliosios and antrinės žaliavos only. Each operator is
unaware of the other's containers at the same address.

Joining on address is also unreliable: Švara writes
`Žalgirio g. 8A, Juragių k., Garliavos apylinkių sen. Kauno r. sav.` while Ekonovus writes
`Juragių k. Žalgirio g. 8A`. A street name is not unique nationally either — `Žalgirio g.
8A` matches both Juragiai and Radviliškis.

## 2026-08-01 — Renamed the skill `atlieku-grafikai` → `binday`

Its scope is the whole app, not only scraping: schedule data, ICS export, service worker
caching and UI share the same non-obvious constraints.
