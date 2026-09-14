---
name: binday
description: >
  Work on BinDay — the Lithuanian waste collection schedule PWA at
  C:\Users\retco\Projects\BinDay — and maintain the data pipeline that feeds it from
  grafikai.svara.lt (UAB Kauno švara) and ekonovus.lt (Ekonovus Power BI report).
  Covers the app itself (built from src/, ICS calendar export, service worker cache,
  address picker and settings) and the fetch → dist → publish pipeline that supplies its
  schedules.
  Use this skill whenever the user mentions BinDay, atliekų grafikai, atliekų išvežimas,
  šiukšlių išvežimas, mišrios komunalinės, pakuotės, stiklas, konteinerio numeris,
  svara.lt, ekonovus.lt, waste pickup dates, or bin collection schedule. Also trigger for:
  refreshing or diagnosing a failed schedule refresh, checking when the next pickup is,
  adding an address or municipality, verifying scraped dates against the operator site,
  rebuilding dist/, or changing the app's UI, calendar export or caching.
  Even a casual "kada isveza siuksles" or "atnaujink grafikus" should bring this skill in —
  both operators serve valid-looking wrong answers, and hand-rolling the path wastes a lot
  of time.
---

# BinDay — waste schedule PWA and its data pipeline

`C:\Users\retco\Projects\BinDay` · live at https://gerimantas.github.io/BinDay/

The app serves **40 959 Kauno r. addresses**, each with its own containers and dates, from
static JSON on GitHub Pages. No backend. It fetches `dist/`, never an operator.

**Refreshing is automated.** `.github/workflows/refresh.yml` runs monthly behind
`tools/precheck.py`; `health.yml` checks weekly that both operators still answer and that
the committed `dist/` still passes its gate. So the usual job here is **diagnosing a run
that failed**, not scraping by hand. Manual scraping is the fallback and is documented in
`references/`.

## First: what is actually being asked?

| The user wants | Go to |
|---|---|
| "when is the next pickup" | Read `dist/kauno-r-sav/data.json`, or just open the app. No network. |
| "atnaujink grafikus" / a schedule looks stale | [Refreshing](#refreshing-the-schedules) |
| a refresh run failed or timed out | [Diagnosing a failed refresh](#diagnosing-a-failed-refresh) |
| a change to the app itself | [Working on the app](#working-on-the-app) |
| a new municipality / a new address | [Adding coverage](#adding-coverage) |
| to know why an operator returned nonsense | `references/operator-gotchas.md` first |

## The address key is `(locality, street, house, flat)` — all four

This is the most important fact in the skill, and two earlier recorded rules said the
opposite. Both are superseded and marked so in `DECISIONS.md`. Dropping any part of the key
does not lose a result — it silently returns **someone else's schedule**.

| dropping | measured effect |
|---|---|
| **locality** | of 1 442 street+house keys present in several localities, **1 406 (97.5%)** have different dates. Švara MIXED: 12/12 |
| **flat** | all **3 746** multi-flat buildings assign each flat its own container; **60%** of Švara multi-flat buildings differ in dates |

```
Girininkų II k. Vėjo g. 12 [Švara]      Biruliškių k. Pastotės g. 7 [Ekonovus GLASS]
  flat 1: 80 dates — weekly               flats 1,2,3,5,6: 5 dates/year
  flat 2: 40 dates — fortnightly          flat 4:         12 dates/year
```

**The transferable rule: verify a key against what it selects, not against how often it
matches.** The wrong rule ("merge on street+house, locality is a display label") came from
a normalisation statistic — ignoring locality raised overlap 88.8% → 90.9% — and survived
three sessions, because an overlap percentage cannot distinguish a merged duplicate from a
wrong schedule. That 2.1% "gain" was houses 20 km apart being handed each other's dates.

Also: a locality is **not** one schedule. 106 (locality, waste-type) pairs carry more than
one; Domeikava and Ringaudai have 8 distinct glass schedules each. The schedule reference
must be per container.

Full numbers: `[[wiki/bin-day/merge-key-s4]]`.

## Both operators serve valid-looking wrong answers

Neither ever errors when it gives you the wrong data. This is the failure class that has
cost the most time in this project, in four separate forms:

- **Ekonovus, unapplied slicer** → a complete schedule for a real but unrelated container in
  another municipality. Observed `13-L-300017`, Biržų r. sav., dates shifting daily.
- **Švara `getcontracts`, `Contains` not equality** → `houseNumber=5` returns `15-1`, `35`,
  `15C`, `3-5`. `Žalgirio g. 8A` without a locality also returns `Žalgirio g. 28A` in
  another village. Send all five fields; **read `fullAddress` back**.
- **Švara `district` vs `region`** → HTTP 200 with 550 subdistricts from the whole country
  instead of the 26 you asked for.
- **Ekonovus truncation at the response window** → a result larger than the window ends
  early with no error. Cost 33 420 containers, 25% of the municipality, every one looking
  like a normalisation miss rather than a truncated fetch. Always page to exhaustion.

The defence in every case is the same: **read back what you asked for, and check the count
against what you expected.** `tools/check_dist.py` encodes this for the pipeline.

Three more traps worth knowing before touching either operator:

- **`getschedule` takes `wasteObjectId`, not `hashedId`.** It returns an *empty result* for
  a `hashedId` under every parameter name. `getcontracts` returns both — carry both.
- **Ekonovus inventory numbers carry a singular type suffix** — `52-P-22781 (Pakuotė)`, not
  the bare number and not the plural the report's own labels use. Bare number → 0 rows.
- **Ekonovus municipality codes are its own.** Code 13 is Vilnius, not Druskininkai.

## Never diagnose with a full run

**Probe the smallest slice that could disprove the hypothesis, then fix, then run the
pipeline to confirm.** A full fetch is 13 min for the Švara catalogue alone and ~40 min
end to end, and it answers slowly *about whichever defect the gate hits first* — which is
usually not the one being investigated. Four consecutive full runs in S5 produced four
guessed fixes; each question could have been settled by a single request:

| Question | Cheap probe |
|---|---|
| Does this subdistrict page correctly? | 3 × `getcontracts` at `pageIndex` 0/1/2 — ~10 s |
| What does the operator send for this container? | one `getcontracts` with all five fields |
| Did my type-resolution change break anything? | read the two fields on the one known container |
| Does the gate catch X? | hand-build a `--previous` fixture, no fetch at all |

Use the flags that exist: `fetch_svara.js --regions "A"`, `fetch_dates_ekonovus_bulk.py
--limit 1`, `check_dist.py --previous <fixture>`. Reserve the full run for confirming a fix
already understood, never for locating one.

Corollary: **when a change alters classification, compare per-type counts, not totals.**
Joining `description` with `descriptionPlural` fixed 56 containers and broke 194 while
leaving the total identical — invisible to any count of containers.

This is the same failure recorded in `[[wiki/bin-day/catalogue-pipeline-lessons]]` after
six blind rebuilds in one session: *guessing was never cheaper than measuring.*

## Refreshing the schedules

Normally: `gh workflow run "Refresh schedules"`, or `-f force=true` to skip the pre-check.
Watch it with `gh run list --workflow="Refresh schedules"`.

By hand, in order:

```bash
python tools/precheck.py                  # 0 unchanged, 10 changed, 1 could-not-tell
node   tools/fetch_svara.js               # Kauno r. only; --all or --regions "A,B"
python tools/fetch_ekonovus.py            # code 52 only; --codes all to widen
node   tools/fetch_dates_svara.mjs        # ~9 min, 8 concurrent
python tools/fetch_dates_ekonovus_bulk.py # ~1.5 min, four 20 000-row pages
python tools/build_dist.py                # raw/ -> dist/
python tools/check_dist.py --previous <d> # publish gate; must pass before committing
```

**`precheck.py` refreshes on *any* non-zero exit**, including "could not reach the
operator". Skipping on an inconclusive check is how a stale schedule survives indefinitely.

**The gate is not optional.** `check_dist.py` is verified by sabotage — `dist/` was broken
nine ways and each break asserted caught — because a gate that only ever passes is
indistinguishable from no gate. It checks, among the obvious things: `Saulės g. 5` resolves
to ≥15 localities (or locality was dropped from the key), `Pastotės g. 7` keeps ≥5 flats (or
the flat was), ≥90% of containers carry dates **per operator** (this is what distinguishes a
paged fetch stopping early from a normalisation miss), no schedule ends before today, and
with `--previous`, that no address vanished and none lost a container.

### raw/ and dist/ are not symmetrical, and that is the design

```
data/raw/   fetch writes here, never deletes    (gitignored; tools/fetch_*)
dist/       build owns it, safe to wipe          (committed; tools/build_dist.py)
```

Destroy `dist/` and it rebuilds from `raw/` in seconds with no network. Destroy `raw/` and
the operators must be asked again — about half an hour. So **only fetch may write `raw/`**,
and `tools/build_index.py`, which deleted files it had not created and lost `Kauno m. sav.`
twice, was removed rather than guarded a second time.

Every write is atomic (temp, fsync, rename) via `tools/atomic.py` / `atomic.mjs`; each
`raw/` file carries a `.meta.json` sidecar. `dist/` deliberately carries no sidecars and no
build timestamp — a timestamp would make an identical rebuild look like new data, and a diff
that is always there is never read.

## Diagnosing a failed refresh

Read the failing step's output before re-running anything; a re-run costs ~30 minutes.

| Symptom | Almost always |
|---|---|
| Coverage below 90% for **one** operator | that operator's paging stopped early — Ekonovus 500-row window, or a Švara subdistrict skipped. Not normalisation. |
| Coverage low for **both** | the merge key changed shape; check `check_dist.py`'s locality/flat witnesses |
| Address count collapsed to a few thousand | the flat was dropped from the key, or one municipality file failed to write |
| A whole municipality missing from the picker | `areas.json` is derived from files on disk — the file did not land |
| Rebuild shows as modified but nothing changed | line endings. `.gitattributes` must set `eol=lf`; Windows checks out CRLF while the generators write LF |
| A cancelled run's log is blank for the failing step | buffered stdout, not a hang. Python buffers to a pipe, and the buffer dies with the process. Both workflows set `PYTHONUNBUFFERED: '1'`; if a new one does not, it is blind. **Silence is not evidence of hanging** — the 2026-08-02 run showed 50 min of nothing and was recorded as "hung, raise the cap" when it was simply slower than planned |
| The run timed out | a full fetch is ~42 min against a 90 min cap, so something is genuinely stuck rather than merely slow. Read the log *first* — `PYTHONUNBUFFERED: '1'` is set precisely so a cancelled run is readable |

## Working on the app

**Edit `src/`, never `index.html`.** The root `index.html` is generated and overwritten on
every build. Sources are plain scripts sharing one scope — no imports, no bundler.

```bash
python tools/build_app.py            # rebuild index.html, bump sw.js CACHE
python tools/build_app.py --check    # verify index.html matches src/ (writes nothing)
```

`build_app.py` bumps `CACHE` in `sw.js` automatically, and only when the output actually
changed. Before it existed, a stale `CACHE` was the single most common way a correct fix
failed to reach the phone — the worker is cache-first, so installed clients keep serving the
old schedule forever.

Rules that break things when ignored:

- **Store published dates, never `anchor + intervalDays`.** Švara's schedule genuinely
  deviates: the window before 2026-08 contained Monday pickups and an off-cycle Wednesday
  run on 2026-07-22, confirmed on the site. A computing app silently skips those, and a
  missed pickup is the one failure the user actually notices. Same reason the ICS writes one
  `VEVENT` per day instead of an `RRULE`.
- **Never extrapolate past a container's `until` date.** It is the operator's published
  horizon, not a guess. Past it the app says "refresh needed". Coverage differs per operator
  — Švara publishes a rolling window, Ekonovus a fixed forward count — so one container
  expiring before the others is normal.
- **Use `isoLocal()`, never `toISOString()`.** The latter converts to UTC and rolls the date
  back an hour before midnight in Lithuania, making the app claim a pickup is "today" on the
  evening before.
- **Keep `apple-touch-icon.png`.** iOS ignores the manifest icons when adding to the home
  screen and substitutes a screenshot of the page without it.
- **Write files as UTF-8 explicitly.** Windows defaults to cp1252 and Lithuanian diacritics
  crash the write.

Calendar export limits, all found the hard way and all undocumented: **Google keeps only the
first `VALARM`** (the file carries 17:00 and 20:00 the evening before; Google drops the
second — fix is a dedicated calendar with two default notifications, not a change to the
file), **Google ignores `COLOR:`** (colour is carried by an emoji in the summary instead),
and **`RRULE` cannot express off-cycle dates**. Event UIDs are stable per date, so
re-importing updates events rather than duplicating them.

### Verify the rendered result, not the code that renders it

Repeatedly in this project a change was "done" in the source and wrong on screen. Checking
that a property exists proves nothing about whether it is visible:

- A `box-shadow` glow at 7% white measured as present and was invisible against the
  near-black page. Sample actual pixels moving out from the element's edge.
- `header { position: relative }`, added later in the file for a child button, silently
  overrode the `position: fixed` above it.
- Body text at `#52525b` is **2.29:1** contrast — half the 4.5:1 minimum, effectively
  invisible outdoors, which is exactly where this app is used. Compute the ratio.
- Two waste colours 19° apart on the hue wheel were indistinguishable side by side. Check
  hue separation as well as contrast.

## Adding coverage

**Only municipalities served by BOTH operators are shipped.** A single-operator area shows
packaging without mixed waste or the reverse, and a schedule that silently omits a bin is
worse than none, because the user trusts it. Those areas stay in `areas.json` as `pending`
so the app can say "being prepared".

The two catalogues are independent — Švara does not know about the Ekonovus containers at
the same address, so neither can be derived from the other. Widen with
`node tools/fetch_svara.js --regions "…"` and `python tools/fetch_ekonovus.py --codes all`,
then rebuild and run the gate.

For a single new address, resolve it through `getcontracts` with all five fields and read
`fullAddress` back — see `references/svara-address-api.md`.

## The app's own address

**Žalgirio g. 8A, Juragių k., Garliavos apylinkių sen., Kauno r. sav.** — used as the
witness in `precheck.py` and asserted by `check_dist.py` to carry all three containers.

| Tipas | Konteinerio Nr. | Operatorius |
|-------|-----------------|-------------|
| MIXED | `52-MK-036668` | UAB Kauno švara |
| PACKAGING | `52-P-22781` | Ekonovus |
| GLASS | `52-S-24716` | Ekonovus |

Resolved Švara ids: `hashedId=EKzJW7DK`, `wasteObjectId=279722`, `dumpsterId=313067`,
`scheduleId=3904`. **Verify container numbers against the site** — the original notes listed
`52-MK-03668`; the site says `52-MK-036668`, and a dropped digit scrapes nothing or someone
else's bin.

## References

Load these only when the task actually needs them:

| File | When |
|---|---|
| `references/operator-gotchas.md` | before debugging a stuck or empty scrape |
| `references/svara-address-api.md` | resolving an address by hand, or `fetch_svara*` broke |
| `references/ekonovus-powerbi-api.md` | querying Power BI directly, or `fetch_ekonovus*` broke |

General firecrawl traps — concurrency deadlocks, pinning the scrape id, `--node` vs
`page.evaluate`, silent empty results — live in the `firecrawl` skill and apply to any
scraping work.

Deeper background lives in the vault: `[[wiki/bin-day/merge-key-s4]]` (the key and its
measurements), `[[wiki/bin-day/data-pipeline]]` (raw → dist, the gate, costs),
`[[wiki/bin-day/catalogue-pipeline-lessons]]` (the layout this replaced and why).

## Legacy: the single-address markdown

`scripts/build_schedule_md.py` and `data/Atlieku_isvezimo_grafikai.md` are from the era when
the app served one hardcoded address. **Nothing reads the markdown now** — the app reads
`dist/`. Do not regenerate it as part of a refresh, and do not treat it as the canonical
source. The script is still useful for a one-off human-readable calendar of a single
address, and `scripts/svara_from_pdf.py` still works for a single known `hashedId`.
