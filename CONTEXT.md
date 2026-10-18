# BinDay — Context

## Status

**active** — 2026-10-18 (S8)

Waste collection schedule PWA, live at https://gerimantas.github.io/BinDay/ (`binday-v38`).
**Serves Žalgirio g. 8A only** (user decision S8): address picker, saved addresses,
geolocation, settings and the `dist/` download were removed from the app. `dist/` (40 959
addresses) and the bulk tools stay in the repo, unused by the app.

**Calendar:** the user's Google Calendar holds all 38 upcoming pickups to 2028-01-04
(re-imported from the phone 2026-10-18, no duplicates). Google drops the file's reminders on
import, so 17:00/20:00 were set per event via Calendar MCP. Nothing is automatic: new dates
need a button press, opening `binday.ics`, then the reminder repair — `binday` skill,
"The user's Google Calendar".

**Švara now blocks automated requests (Cloudflare Turnstile, since ~2026-10-05).** Every
API/PDF/ICS call without a session cookie gets HTTP 403, from a runner or a home IP. The
monthly workflow (`health.yml`, 1st at 05:23 UTC) therefore updates Ekonovus live and takes
Švara dates from `data/zalgirio_svara.json`, refreshed by hand in the user's Chrome
(Claude in Chrome, since S7) with `tools/svara_session_dates.js`. The run fails on purpose as an email reminder when that file
is >92 days old or its dates end within 90 days — first expected ~2027-01-12. Details:
`CLAUDE.md` and `.claude/skills/binday/references/svara-address-api.md`. **The bulk Švara
tools (`fetch_svara.js`, `fetch_dates_svara.mjs`) are broken by the same gate** — dormant,
not fixed.

## Next Tasks

- **When GitHub emails "Run failed: Žalgirio 8A schedule update", refresh Švara by hand.**
  In Claude in Chrome open `https://grafikai.svara.lt/`, run `tools/svara_session_dates.js`
  with `javascript_tool` on that tab, save the result to `data/zalgirio_svara.json`, then
  `python tools/update_zalgirio_schedule.py`, `python tools/build_app.py`. On 403/404 with a live session the function ids changed —
  method in `.claude/skills/binday/references/svara-address-api.md`.
- **Automatic calendar sync — user wants it, not built.** Two options offered S8: (1) an
  `.ics` subscription URL on Pages, added once via Google "From URL" (refresh 12–24 h,
  reminders unverified); (2) GitHub Actions writing events through a Google service account.
  User has not chosen.
- **App defects left for the Žalgirio-only app** (found S8, not fixed): `sw.js` precaches only
  `./index.html`, so an offline launch via `/BinDay/` or the QR link may fail; install may
  precache a stale `index.html` from the HTTP cache; ICS `DTEND` uses `+864e5` (wrong on DST
  fall-back days, no Žalgirio pickup affected); ICS lacks a trailing CRLF; expired-schedule
  footer shows developer text "Perscrapink…".
- **`binday` evals are stale:** `.evals/README.md` points to `C:\Users\retco\.ai-skills\binday`
  (does not exist) and scenarios assume the multi-address app. Rewrite before re-running.
- **337 addresses (0.8%) still have a container without dates.** Not investigated: whether
  the operators publish nothing for them or the parse misses them. `check_dist.py` enforces
  a 90% floor per operator, so this is visible but tolerated.
- **`data/Atlieku_isvezimo_grafikai.md` is now orphaned.** It was the canonical schedule
  source when the app shipped one hardcoded address; `dist/` has superseded it and nothing
  reads it. Delete it, or keep it deliberately as a human-readable record and say so.
- Consider a `pwa-single-file` skill once a third PWA exists — this session re-solved
  service-worker cache bumps, the iOS `apple-touch-icon` requirement, and two date bugs
  that the Grafikai project had already hit.
- Consider an `ics-calendar` skill covering the three undocumented client limits found
  here: Google keeps one VALARM, Google ignores `COLOR:`, and RRULE cannot express
  off-cycle dates.

## Done Log

- **S8:** App cut to Žalgirio g. 8A only (multi-address code removed, 83 → 38 KB); calendar
  re-imported from the phone (38 events, no duplicates) and reminders set via Calendar MCP;
  docs and `binday` skill corrected (16 stale claims).
- **S7:** Švara refresh moved from Playwright MCP to Claude in Chrome (BrowserOS neo blocked
  by Smart App Control); verified live, dates unchanged.
- **S6:** Diagnosed the two failed Žalgirio runs (2026-10-05, 10-12): Švara Turnstile 403,
  plus a redeploy that replaced the generic `apiPath` server function. Švara now read from a
  file; Ekonovus no longer blocked by a Švara failure; checks monthly instead of weekly.
- **S6:** App: per-operator check dates, calendar export state, "new version" offer.
- **S5:** Ekonovus dates 65 min → 1.5 min: filter on the inventory prefix and page 20 000
  rows at a time, four requests for Kauno r. Verified on the runner and against the shipped
  build — 132 250 pairs, none lost, every date difference explained by the sliding horizon.
- **S5:** Set `PYTHONUNBUFFERED` in both workflows. The 2026-08-02 timeout showed 50 minutes
  of empty log and was recorded as "hung"; it was buffered output dying with the process,
  and the step was merely slow. Paid for itself immediately on the next failures.
- **S5:** Publish gate now compares waste types per address, not container ids or row
  counts — Švara renumbers in place (31 in one day, mostly a `SENAS` suffix) and Ekonovus
  lists nine containers twice. Both directions verified.
- **S5:** Rewrote the `binday` skill for the post-S4 world (517 → 269 lines, two new
  `references/` files) and replaced all three evals, which asserted the single-address era
  and demanded the `anchor + intervalDays` block the skill forbids.
- **S5:** Fixed `_regen-index.py` writing a YAML block-scalar `>` into INDEX.md for three
  skills.
- **S4:** Executed all ten steps of `.planning/PIPELINE_PLAN.md`. Multi-address works in
  production: 40 959 addresses, 99.5% of containers dated, offline after one load,
  verified against the live site in a browser.
- **S4:** Corrected the merge key to `(locality, street, house, flat)` by measuring against
  fetched dates instead of match rates, and marked two superseded rules in `DECISIONS.md`.
  The "88.8% ceiling" three sessions chased was mostly the flat rule; real operator
  disagreement is 0.2%.
- **S4:** Split `index.html` into `src/` with `tools/build_app.py` reassembling it and
  bumping `CACHE` automatically. Still one file when served.
- **S4:** Established `raw/` + `dist/` with atomic writes, and deleted `build_index.py` —
  the script that removed files it had not created and lost `Kauno m. sav.` twice.
- **S4:** Found and fixed four silent defects, each invisible to every check in place at
  the time: `hashedId` does not drive `getschedule`; the Power BI date query's unpaged
  500-row window cost 25% of the municipality; `version.json` was cached by the worker that
  depends on it being fresh; `cache: 'reload'` does not bypass a service worker.
- **S3:** Measured the address→container→dates chain end to end and wrote
  `.planning/PIPELINE_PLAN.md` from it. Rejected the RC Address Register as the search
  source on measurement (53.7% of its Kauno r. addresses have no container anywhere);
  merged the operator catalogues instead into 36 348 addresses.
- **S3:** Found dates are reachable in bulk from **both** operators, contradicting the
  notes: Ekonovus per locality once a `StartsWith` filter is applied, Švara as JSON from
  `getschedule` with `tenantId` in the payload. Recorded the two Power BI traps that
  produce confident wrong output with no error.
- **S3:** Verified GitHub Actions can reach both operators from a runner, and that neither
  operator rate-limits (200 Švara requests, 40 Ekonovus localities, zero failures).

## Key Facts

- **Ekonovus has an anonymous bulk API; Švara no longer does (Turnstile since 2026-10).**
  The S3–S5 claim "no browser needed" now holds for Ekonovus only.
  [[wiki/bin-day/svara-address-api]] (seroval chain, `region` not `district`, 58 477
  containers in Kauno r.) and [[wiki/bin-day/ekonovus-powerbi-api]] (Power BI `querydata`,
  gzip, singular `(Pakuotė)` suffix). This overturns the S1 claim that Ekonovus requires a
  browser — that claim is now marked superseded in [[wiki/bin-day/schedule-scraping]].
- **Švara sends no CORS; Ekonovus does.** Corrected in S3 — the earlier blanket "neither
  operator sends CORS" held only for Švara (no headers, preflight 405). Ekonovus' Power BI
  answers `Access-Control-Allow-Origin: *` and its preflight allows
  `x-powerbi-resourcekey`, so it *is* browser-reachable. It does not change the design:
  schedules are published months ahead, so static JSON on Pages remains the delivery
  mechanism and keeps the app working with no signal.
- **The two catalogues cannot be derived from each other, but they can be merged on
  `(locality, street, house, flat)` — all four.** Švara's Kauno r. data holds no packaging
  or glass; Ekonovus writes the same address differently. S4 measured the key against
  fetched dates: 40 959 addresses for Kauno r. The S3 figures (88.9%, 36 348 addresses,
  street+house key) are superseded — see [[wiki/bin-day/merge-key-s4]].
- **Both operators truncate silently, in three different ways.** Švara's `getcontracts`
  paging stops on an absent `totalPages` (S5, open); the Power BI date query truncates at
  its response window with no error (S4, fixed); Ekonovus' catalogue query is not ordered
  by municipality, so a container can be absent from the first pages. **Assert the total
  after every fetch** — a short result is indistinguishable from the operator having less
  data, and all three looked like normalisation misses.
- Dates are stored as explicit lists, never `anchor + intervalDays`. Švara's schedule
  genuinely deviates — the window before 2026-08 held Monday pickups and an off-cycle
  Wednesday run on 2026-07-22, independently confirmed on the site. A computing app would
  silently skip those.
- The ICS writes one `VEVENT` per day for the same reason; Švara's own feed uses an RRULE
  that cannot express those deviations.
- Ekonovus Power BI serves a **valid-looking wrong answer** when a slicer fails to apply —
  a complete schedule for an unrelated container in another municipality, with no error.
  Always read the address back.
- Švara ids for Žalgirio: `hashedId=EKzJW7DK` (drives the post-2026-10 schedule function),
  `wasteObjectId=279722`. The unauthenticated PDF fast path (`/api/download/<hashedId>`)
  returns 403 since 2026-10.
- Seven SKILL.md files carry a UTF-8 BOM from a batch install (2026-04-01 and 2026-04-07;
  counted 2026-10-18).
  Harmless to the index generator, but any tool anchoring on `^---$` will miss their
  frontmatter.

## Archive

### Session 2026-10-18 — S8: app cut to Žalgirio only; calendar re-imported, reminders repaired

- **Done:** bug hunt (3 agents) found 17 app defects + 16 stale doc claims; fixed LOCATION,
  per-address UIDs, the 4 worst multi-address bugs, then removed all multi-address code
  (picker, saved addresses, geolocation, settings, `dist/` download) — page 83 KB → 38 KB,
  ICS and page text byte-identical. Docs rewritten. User re-imported the calendar from the
  phone: 38 events to 2028-01-04, 24 updated / 14 new / 0 duplicates. Google dropped both
  VALARMs; reminders 17:00/20:00 set on all 38 via Calendar MCP. Live `binday-v38`.
- **Decided / overturned:** app serves Žalgirio g. 8A only (user, option 1: `dist/` and bulk
  tools kept). Overturned: "phone Google Calendar cannot import .ics" (it did, twice);
  "re-import may duplicate" (Google event id = base32hex of the UID, confirmed in place).
- **Code:** deleted `src/js/{catalog,search,settings,storage,version}.js`; changed
  `src/js/{data,ics,main,render}.js`, `src/index.html`, `src/styles.css`, `sw.js`,
  `tools/build_app.py`, `CLAUDE.md`, `.claude/skills/binday/SKILL.md`.
- **Entry point:** `python tools/build_app.py`; calendar procedure: `binday` skill, section
  "The user's Google Calendar".
- **Not measured:** `binday` evals not re-run (they assume the multi-address app); whether
  the next re-import resets the reminders again; automatic calendar sync not built.

### Session 2026-10-12 — S7: Švara refresh moved to Claude in Chrome

- **Done:** BrowserOS neo found blocked by Windows Smart App Control (now enforcing; unsigned
  `chrome.dll`, upstream issue #2080 closed unfixed). Agent browser switched to Claude in
  Chrome (`/chrome` enabled by default); BrowserOS MCP server and skill removed.
  `tools/svara_session_dates.js` rewritten as page code for `javascript_tool`; live run in
  the user's Chrome passed Turnstile with no checkbox and returned the same 33 dates as
  `data/zalgirio_svara.json`.
- **Decided / overturned:** Claude in Chrome replaces BrowserOS and, for BinDay, Playwright
  MCP (user, option 1). Playwright stays installed as fallback.
- **Code:** `tools/svara_session_dates.js`; docs in `CLAUDE.md`, `CONTEXT.md`,
  `.claude/skills/binday/SKILL.md`, `references/svara-address-api.md`.
- **Entry point:** Claude in Chrome → open `https://grafikai.svara.lt/` → `javascript_tool`
  with the file's text. Why/how: vault `wiki/agents/claude-in-chrome.md`.
- **Not measured:** `binday` evals not re-run (one-sentence doc change).

### Session 2026-10-12 — Švara behind Turnstile; monthly check; update offer

- **Done:** found both failed runs were Švara HTTP 403 (Cloudflare Turnstile + redeployed
  server functions); Švara dates now from a hand-refreshed file, Ekonovus live; workflow
  monthly with a stale-Švara reminder failure; app shows per-operator check dates, calendar
  export state, and a "new version · Atnaujinti" offer. Pushed, live as `binday-v27`.
- **Decided / overturned:** no automated bypass of Švara's human check (user chose manual
  refresh, option A). Overturned: "Švara has an anonymous API / PDF fast path".
- **Code:** `tools/svara_session_dates.js`, `data/zalgirio_svara.json`,
  `tools/update_zalgirio_schedule.py`, `.github/workflows/health.yml` (probe_svara.mjs
  deleted), `src/js/update.js`, `src/js/ics.js`, `src/js/render.js`, `src/js/data.js`,
  `src/js/main.js`, `src/styles.css`, `sw.js`, `tools/build_app.py`, docs in `CLAUDE.md`,
  `README.md`, `binday` skill.
- **Entry point:** `python tools/update_zalgirio_schedule.py [--check-svara]`; Švara:
  Playwright MCP `browser_run_code_unsafe filename=tools/svara_session_dates.js`.
- **Not measured:** "Grafikas atnaujintas" toast (needs a real data change); whether Google
  re-import truly updates rather than duplicates. BrowserOS neo blocked by Windows Smart App
  Control (unsigned `chrome_elf.dll`) — PC task, not fixed.

### Session 2026-08-03 — S5

Started as a skill rewrite, became a pipeline investigation, and ended with the user
stopping me for the right reason.

**The skill rewrite went cleanly** because a plan already existed: `.planning/SKILL_REWRITE.md`
listed eight verified defects and the order to fix them, so nothing had to be re-derived.
517 lines → 269, the Power BI and Švara call shapes moved to `references/`, and the three
evals were replaced — all of them asserted the single-address world, and eval 0 demanded
an `anchor + intervalDays` block that the skill explicitly forbids. A failing eval there
meant the eval was wrong, not the skill, which makes the suite worse than absent.

**The real find was in the workflow logs.** The 2026-08-02 timeout had been recorded as
"hung at Fetch dates, split the jobs or raise the cap". Both wrong. The log showed 50
minutes of nothing because Python buffers stdout to a pipe and the buffer died with the
cancelled process — the step had not hung, it was fetching 266 localities one at a time.
Measured on untouched localities: a query costs ~10 s regardless of what it returns (4 rows
12.1 s, 443 rows 13.7 s), because the `Datos` measure is evaluated across the national
table per request. Filtering on the inventory prefix and asking for 20 000 rows pulls all
of Kauno r. in four requests, ~1.5 min. The recorded 500-row cap was never a server limit.

**Then four consecutive ~40-minute runs, each fixing a guess.** The gate blocked every one,
correctly, but each time about a *different* defect: duplicate Ekonovus rows collapsing;
Švara renumbering 31 containers in place with a `SENAS` suffix; a blank `inventoryNumber`
dropping MIXED from an address; and finally Švara's paging reading an absent `totalPages`
as zero and taking one page per subdistrict (58 477 → 52 483, silent, with 24 of 26
subdistricts byte-identical). The last is diagnosed but **not fixed** — the replacement
works locally and produces 54 306 on the runner.

**The user's correction is the durable output.** Three full catalogue rebuilds (13 min
each) were spent testing behaviour in *one* subdistrict, answerable in three requests and
ten seconds. Worst case: joining `description` with `descriptionPlural` to rescue 56
containers broke 194 GREEN ones — `descriptionPlural` says "mišrių atliekų" for containers
whose `description` says "Žaliųjų atliekų" — and the container total was identical, so only
per-type counts revealed it. That is the same shape as S2's six blind rebuilds, already
written up in [[wiki/bin-day/catalogue-pipeline-lessons]] with the line *guessing was never
cheaper than measuring*. I had not read it. The rule now lives in the skill, and
`.planning/SVARA_PAGING.md` records the cheap probe so the next session does not repeat the
cycle.

Nothing broken shipped: `dist/` is untouched and the gate held every time.

### Session 2026-08-02 — S4 (2026-08-02/03)

Executed all ten plan steps. The session began by auditing the plan rather than running
it, and that audit is what made the rest worth doing.

**The plan was well-measured but carried a rule nobody had questioned.** Checking every
claim against the code found no hallucinations — line numbers, the live 404, the missing
`cache.put` all held. But two recorded rules were wrong, and the user's pushback is what
surfaced both. Asked to analyse the plan, I found a contradiction inside `DECISIONS.md`
about locality. Asked *"why don't you understand that the same street name can be in
different localities"*, I re-measured and found my own "zero collisions" answer had
counted the wrong thing — I had measured operator spelling disagreement and called it
collision risk, while printing `vytauto g 10 → [garliav, naujasodz, vilkij, zapysk]` two
lines above the claim. Asked *"is this solvable or a dead end"*, measuring against fetched
dates instead of overlap rates showed 14 of the 17.8 percentage points were the flat rule,
ours, not the operators'.

**A retracted mid-session claim, recorded because it is the same error as the original
rule:** from four containers in one town I concluded flats share dates and the flat is
noise for scheduling. A wider sample overturned it — true for Ekonovus (99.6%), false for
Švara (40%). A small convenient sample generalised into a rule, which is exactly how
*"a container stands at a building, not a flat"* got written in the first place.

**Four defects only running found**, each silent: `hashedId` does not drive `getschedule`
(only `wasteObjectId`, which the fetcher was discarding); the Power BI date query has an
unpaged 500-row window that cost 33 420 containers looking exactly like a normalisation
miss; `version.json` matched the worker's own cache pattern, so the update would have
failed on the deploy it exists to deliver; and `cache: 'reload'` does not bypass a service
worker, so the signature updated while the data did not — worse than not updating, because
the client then believes it is current.

**Process notes.** Twice I acted without being asked — starting step 3 after a rhetorical
question, and launching the fetchers without checking they had any notion of scope, which
downloaded five out-of-scope municipalities. Twice I asked the user to decide something
already recorded in `DECISIONS.md` (bulk vs live dates) instead of reading it. And a
promise to move `storage.js` "later" lived only in a commit message until the user asked
what guaranteed it — done immediately instead, since the deferred work was smaller than
writing it down.

Verification pattern that paid off repeatedly: **test by sabotage, not by passing.**
`check_dist.py` is exercised by breaking `dist/` nine ways and asserting each is caught
with a message that explains why. Running the workflow's post-fetch half offline — rather
than waiting out a 40-minute cloud run — found two more defects (a build timestamp
causing a monthly no-op commit, and CRLF/LF churn) in seconds.
