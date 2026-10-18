---
name: binday
description: >
  Work on BinDay — the Lithuanian waste collection schedule PWA at
  C:\Users\retco\Projects\BinDay — and maintain the data pipeline that feeds it from
  grafikai.svara.lt (UAB Kauno švara) and ekonovus.lt (Ekonovus Power BI report).
  Covers the app itself (built from src/, one address only, ICS calendar export, service
  worker cache), the monthly Žalgirio g. 8A update, and the dormant fetch → dist pipeline
  for the whole of Kauno r.
  Use this skill whenever the user mentions BinDay, atliekų grafikai, atliekų išvežimas,
  šiukšlių išvežimas, mišrios komunalinės, pakuotės, stiklas, konteinerio numeris,
  svara.lt, ekonovus.lt, waste pickup dates, or bin collection schedule. Also trigger for:
  refreshing or diagnosing a failed schedule refresh, checking when the next pickup is,
  adding an address or municipality, verifying scraped dates against the operator site,
  rebuilding dist/, or changing the app's UI, calendar export or caching. Also for the
  user's Google Calendar copy of the pickups: "ar kalendorius atsinaujino", "patikrink
  kalendorių", "sutvarkyk priminimus", missing or duplicate pickup events.
  Even a casual "kada isveza siuksles" or "atnaujink grafikus" should bring this skill in —
  both operators serve valid-looking wrong answers, and hand-rolling the path wastes a lot
  of time.
---

# BinDay — waste schedule PWA and its data pipeline

`C:\Users\retco\Projects\BinDay` · live at https://gerimantas.github.io/BinDay/

**The app serves one address: Žalgirio g. 8A, Juragiai** (user decision, 2026-10-18). Its
dates ship inside `index.html` (`DEFAULT_SCHEDULE` in `src/js/data.js`); the app fetches
nothing. The address picker, saved addresses, geolocation and the `dist/` download were
removed in commits `b01ce95`, `a410532`, `7e540be` — restore from there if more addresses
are ever wanted. `dist/` (40 959 Kauno r. addresses) and the bulk tools stay in the repo,
unused by the app.

**Refreshing is partly automated.** `.github/workflows/health.yml` ("Žalgirio 8A schedule
update", 1st of the month 05:23 UTC) runs `tools/update_zalgirio_schedule.py`: Ekonovus live,
Švara from `data/zalgirio_svara.json`, then rebuilds the app and validates the committed
`dist/`. The bulk refresh workflow (`refresh.yml`) was removed 2026-09-14.

**Švara is behind Cloudflare Turnstile since 2026-10.** Every request without a session
cookie gets HTTP 403 `Užklausa neleidžiama.` — API, PDF and ICS alike, from a runner or a
home IP. The cookie (`__Host-gs_session`, 30 min) is issued by `POST /api/session` only after
"Verify you are human" passes, so a GitHub runner cannot read Švara and we do not automate
past it. Its Žalgirio dates live in `data/zalgirio_svara.json`, refreshed in a watched
browser with `tools/svara_session_dates.js` (Claude in Chrome: open
`https://grafikai.svara.lt/`, then `javascript_tool` with the file's text on that tab; the
user's own Chrome passed without a checkbox on 2026-10-12); the monthly run fails with "Švara needs a manual check" when the file is over
92 days old or its dates end within 90 days. The bulk Švara tools are broken by the same gate.

## First: what is actually being asked?

| The user wants | Go to |
|---|---|
| "when is the next pickup" | Read `DEFAULT_SCHEDULE` in `src/js/data.js`, or open the app. No network. |
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

Žalgirio g. 8A: `gh workflow run "Žalgirio 8A schedule update"`, watch with
`gh run list --workflow="Žalgirio 8A schedule update"`. Švara first needs a fresh
`data/zalgirio_svara.json` from the browser (see the Turnstile paragraph above).

The whole of Kauno r. (only when the user explicitly asks — the app does not use it), by
hand, in order:

```bash
python tools/precheck.py                  # 0 unchanged, 10 changed, 1 could-not-tell
node   tools/fetch_svara.js               # Kauno r. only; --all or --regions "A,B"
python tools/fetch_ekonovus.py            # code 52 only; --codes all to widen
node   tools/fetch_dates_svara.mjs        # 2 concurrent by default; ~9 min at --concurrency 8
python tools/fetch_dates_ekonovus_bulk.py # four 20 000-row pages
python tools/build_dist.py                # raw/ -> dist/
python tools/check_dist.py --previous <d> # publish gate; must pass before committing
```

The Švara steps are blocked by Turnstile. `precheck.py` exits 0 unchanged, 10 changed, 1
could-not-tell; treat 1 as "refresh", never as "skip" — skipping on an inconclusive check is
how a stale schedule survives indefinitely.

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
`raw/` file carries a `.meta.json` sidecar. `dist/` carries no sidecars. `dist/version.json`
does carry a `built` timestamp, written by `update_zalgirio_schedule.py`.

## Diagnosing a failed refresh

Read the failing step's output before re-running anything; a re-run costs ~30 minutes.

| Symptom | Almost always |
|---|---|
| Coverage below 90% for **one** operator | that operator's paging stopped early — Ekonovus 500-row window, or a Švara subdistrict skipped. Not normalisation. |
| Coverage low for **both** | the merge key changed shape; check `check_dist.py`'s locality/flat witnesses |
| Address count collapsed to a few thousand | the flat was dropped from the key, or one municipality file failed to write |
| A whole municipality missing from `areas.json` | it is derived from files on disk — the file did not land |
| Rebuild shows as modified but nothing changed | line endings. `.gitattributes` must set `eol=lf`; Windows checks out CRLF while the generators write LF |
| A cancelled run's log is blank for the failing step | buffered stdout, not a hang. Python buffers to a pipe, and the buffer dies with the process. Both workflows set `PYTHONUNBUFFERED: '1'`; if a new one does not, it is blind. **Silence is not evidence of hanging** — the 2026-08-02 run showed 50 min of nothing and was recorded as "hung, raise the cap" when it was simply slower than planned |
| The monthly run failed with "Švara needs a manual check" | intended: `data/zalgirio_svara.json` is over 92 days old or its dates end within 90 days. Refresh it in the browser |
| The run timed out | `health.yml` has a 15 min cap and touches one address, so something is stuck. Read the log *first* — `PYTHONUNBUFFERED: '1'` is set precisely so a cancelled run is readable |

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

### The user's Google Calendar

The user keeps the pickups in Google Calendar `gerimantas.v@gmail.com`. Nothing about it is
automatic: new dates reach it only when the user presses the app's calendar button again.

**How the import works (Android, measured 2026-10-18).** The button only saves `binday.ics`
to Downloads; the app cannot see the calendar and says only "Kalendoriaus failas
atsisiųstas". The import happens when the user opens the file from the download
notification or *Mano failai → Atsisiuntimai* and picks the calendar app.

**Re-import updates in place.** Event UIDs are `binday-YYYYMMDD@binday.local` (unchanged since
the first release) and Google's event id is `_` + lowercase base32hex of the UID, no padding
(`_c9kmsp31f4mj4c1i6ooj0chn81h6irj4c5sisr3fcdgmo` = `binday-20261027@binday.local`). The
2026-10-18 re-import updated 24 events, added 14, duplicated none. Never change the UID form:
every event already in the calendar would be duplicated.

**Google drops the file's reminders.** The file carries `VALARM`s at 17:00 and 20:00 the
evening before; on the 2026-10-18 import none of the 38 events kept either (all fell back to
the calendar default). **Repair after every import**, once the user says yes:

1. Read the events (Haiku subagent, `list_events` on `gerimantas.v@gmail.com` from today to
   the last `until`, raw output saved) and check every app date is present once.
2. For each upcoming BinDay event, Google Calendar MCP `update_event` with
   `useDefaultReminders: false`, `overrideReminders` popup 420 and popup 240 (= 17:00 and
   20:00 the evening before an all-day event), `notificationLevel: NONE`. Try one event
   first and read the response back.

Other client limits, all undocumented: **Google ignores `COLOR:`** (colour is carried by an
emoji in the summary instead), and **`RRULE` cannot express off-cycle dates**, which is why
every pickup is its own event.

`update_zalgirio_schedule.py` edits `src/js/data.js` by regex: keep `DEFAULT_SCHEDULE`,
`DEFAULT_COLLECTED` and the `DEFAULT_CHECKED_*` lines named and shaped as they are.

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

The app currently shows one address and has no picker; adding coverage to the *app* means
restoring the removed code first (commits listed at the top). What follows applies to `dist/`.

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
