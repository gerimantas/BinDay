# BinDay — Context

## Status

**active** — 2026-08-02 (S3)

Waste collection schedule PWA, live at https://gerimantas.github.io/BinDay/ and
installable to a phone home screen. Answers one question — do the bins go out tonight —
and exports the whole schedule to a calendar.

S3 measured the whole address→container→dates chain and wrote an implementation plan from
it (`.planning/PIPELINE_PLAN.md`, committed `54abf93`). No app code changed.

**The multi-address feature does not work in production, and the reason is worse than
"stale data": there is no data path at all.** `data/catalog/` is gitignored, so the live
`data/catalog/areas.json` returns **404**; `sw.js` caches no data file and calls
`cache.put` nowhere; and `applyActive()` reads an `a.schedule` that nothing ever writes, so
every saved address shows "Išvežimo datos šiam adresui dar neįkeltos". Found by checking
the code rather than the notes about it — this corrected six claims in the plan's own first
draft.

What the measurements settled: the RC Address Register is the **wrong** source (a container
belongs to a contract, not an address — 53.7% of its Kauno r. addresses have none), the
address list must come from the operator catalogues (36 348 merged addresses), and dates
are reachable in bulk from both operators, contradicting the earlier notes. Scope is now
**Kauno r. only** — Kaunas city is communal containers, a different product.
See [[wiki/bin-day/address-chain-s3]] for the full measured chain.

Three containers at Žalgirio g. 8A, Juragiai — all collected on Tuesdays:

| Type | Container | Operator | Interval | Published until |
|------|-----------|----------|----------|-----------------|
| MIXED | `52-MK-036668` | UAB Kauno švara | 14 d | 2027-07-20 |
| PACKAGING | `52-P-22781` | Ekonovus | 21 d | 2027-03-23 |
| GLASS | `52-S-24716` | Ekonovus | 84 d | 2027-07-06 |

**Prior status (S2):** proved both operators expose anonymous bulk APIs so no backend is
needed; built the catalogue tooling, the ☰ menu with saved addresses, address search and
the redesign. Left the catalogue pipeline untrustworthy — rebuilt six times, `Kauno m.
sav.` destroyed twice by `build_index.py` deleting files it did not create.

## Next Tasks

- **Execute `.planning/PIPELINE_PLAN.md`, starting at step 1.** Ten ordered steps, each
  verifiable alone. Step 1 is a prerequisite for everything else and is small: `CONTAINERS`
  is a `const` array that `applyActive()` mutates in place (`CONTAINERS.length = 0`), which
  works only by shared scope — split into modules and the mutation stops propagating
  silently, leaving the app rendering the hardcoded Juragiai schedule while claiming another
  address. Replace it with `setActiveSchedule()`/`getSchedule()` as its own commit against
  the current single file, where it is verifiable. Plan: `.planning/PIPELINE_PLAN.md`.
- **Decide the `localStorage` migration before plan step 8 — it is a one-way door.**
  `binday.addresses` stores Švara's full address string; the merged list keys on
  `(locality, street, house)`, so saved entries cannot match by construction. Migrate by
  re-resolving through the new index and keep unresolved entries visible and marked; a user
  whose addresses vanish silently has no way to know why.
- **Delete `.github/workflows/probe-operators.yml` once the real build workflow exists**, or
  keep it deliberately as a health check. It answered its question — both operators respond
  from a runner, Ekonovus faster there (0.6 s) than locally (9.4 s).
- **Split the `binday` skill once the data pipeline stops changing.** SKILL.md is 470
  lines / 25.7 KB and loads on every trigger. The Power BI section alone is 93 lines
  (20%) of call-shape detail only needed when actually calling Ekonovus — move it to
  `references/` like `operator-gotchas.md`, leaving ~380 lines. Deliberately deferred:
  refactoring the skill while the tools it documents are still being fixed risks
  breaking both at once.
- **Second calendar reminder does not survive Google import.** Google Calendar keeps only
  the first `VALARM` from an imported ICS, so the 20:00 alert is dropped and only 17:00
  shows. Fix by creating a dedicated `BinDay` calendar in Google with two default event
  notifications (1 day before at 17:00 and at 20:00) and importing into it — the file
  itself is correct and needs no change. Alternative if that's unwanted: emit two timed
  events on the evening before instead of one all-day event.
- **Refresh the schedule — Švara has extended MIXED to 2027-10-12**, six dates beyond what
  `data/Atlieku_isvezimo_grafikai.md` records. Use the `binday` skill; the fast
  path is the unauthenticated PDF endpoint, not the browser. After regenerating, update
  `CONTAINERS` in `index.html` and bump `CACHE` in `sw.js`.
- Consider a `pwa-single-file` skill once a third PWA exists — this session re-solved
  service-worker cache bumps, the iOS `apple-touch-icon` requirement, and two date bugs
  that the Grafikai project had already hit.
- Consider an `ics-calendar` skill covering the three undocumented client limits found
  here: Google keeps one VALARM, Google ignores `COLOR:`, and RRULE cannot express
  off-cycle dates.

## Done Log

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
- **S2:** Proved both operators have anonymous bulk APIs and that no backend is needed;
  built the catalogue tooling, the ☰ menu with saved addresses, and the redesign
  (outlined type labels, readable contrast, orange instead of red).
- **S2:** Fixed contrast across the app — body text was `#52525b` at **2.29:1**, half the
  4.5:1 minimum and effectively invisible outdoors, which is where the app is used.
- Created the app: single-file PWA, neon palette (red/yellow/green per waste type),
  expandable schedule list, ICS export, QR scan sheet, PWA icons.
- Created the schedule-scraping skill (then named `atlieku-grafikai`, since renamed to
  `binday`) and hardened it through a 6-agent eval that found
  8 real defects, including a silent bug where `firecrawl interact` without `-s` attaches
  to another agent's browser session.
- Extended the `firecrawl` skill with the general lessons: pinning the scrape id, the
  concurrency deadlock, `--code` returning the last expression while `console.log` is
  swallowed, and a `--node` example that could not have worked as written.
- Put the 48-skill library under version control at `github.com/gerimantas/ai-skills`
  (private). Excluded a 105 MB bundled virtualenv; the repo is 7.4 MB.

## Key Facts

- **Both operators have anonymous bulk APIs — no browser, no backend needed.**
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
- **The two catalogues cannot be derived from each other, but they can be merged.** Švara's
  Kauno r. data holds no packaging or glass; Ekonovus writes the same address differently
  (`Juragių k. Žalgirio g. 8A` vs Švara's full official form). S3 measured the merge:
  **88.9%** of addresses appear at both, giving 36 348 for Kauno r. Locality must stay in
  the merge key — `Vytauto g. 85` exists in both Garliavos m. and Zapyškio mstl.
  See [[wiki/bin-day/address-chain-s3]].
- **The deployed app cannot load a catalogue.** `data/catalog/` is gitignored, so the live
  `data/catalog/areas.json` is a 404; `sw.js` caches no data file; `a.schedule` is read but
  never written. Fixed by plan steps 7–8, not by a data refresh.
- Dates are stored as explicit lists, never `anchor + intervalDays`. Švara's schedule
  genuinely deviates — the window before 2026-08 held Monday pickups and an off-cycle
  Wednesday run on 2026-07-22, independently confirmed on the site. A computing app would
  silently skip those.
- The ICS writes one `VEVENT` per day for the same reason; Švara's own feed uses an RRULE
  that cannot express those deviations.
- Ekonovus Power BI serves a **valid-looking wrong answer** when a slicer fails to apply —
  a complete schedule for an unrelated container in another municipality, with no error.
  Always read the address back.
- Fast path for Švara: `curl https://grafikai.svara.lt/api/download/EKzJW7DK` returns the
  full year as a PDF, unauthenticated, ~2 s and zero credits. Cross-checked 24/24 against
  a browser scrape. `hashedId=EKzJW7DK`, `wasteObjectId=279722`.
- Ten SKILL.md files carry a UTF-8 BOM from a batch install (2026-04-01 and 2026-04-07).
  Harmless to the index generator, but any tool anchoring on `^---$` will miss their
  frontmatter.

## Archive

### S3 — 2026-08-02

A research session; no app code changed. The user repeatedly rejected reasoning from
what was already written down, and each time that produced a correction.

The chain was rebuilt from the other end. I had been measuring how many *operator*
addresses appear in the RC Address Register (99%, which sounded excellent) when the user
asked the inverse — how many register addresses have a container. **53.7% do not**, because
a container belongs to a contract, not to an address, and allotment areas share communal
bins. That killed the register as the search source. Merging the two operator catalogues
instead gives 36 348 addresses for Kauno r., and makes "address not found" impossible by
construction.

Three claims recorded in the vault turned out to be wrong or too narrow, and were
superseded rather than deleted: Ekonovus dates *can* be fetched in bulk (per locality, once
a `StartsWith` filter is applied — the "too slow" finding held only for the unfiltered
query), Švara returns dates as JSON without the PDF (`getschedule` needs `tenantId`; without
it the server answers 200 with an empty result rather than an error), and the two operators
*can* be joined on address (88.9%).

I also produced a confident wrong answer mid-session and had to retract it: filtering Power
BI on `ScheduleDates.Date` returned 35 481 containers "served on 2026-08-04" in 5 s. It was
a cross product — that table is a bare calendar with no relationship to any container. The
tell was there (every date populated, Sundays included, counts pinned to the window) and I
reported it as a result anyway. What caught it was a cross-check against a single
container's own schedule. Recorded in `DECISIONS.md`: **Power BI's
`InvalidUnconstrainedJoin` not firing does not prove a join is valid** — `Adresas`+`Date`
does not raise it and is exactly the fabricating query.

The plan was then audited against the code rather than against these notes, on the user's
instruction, and six of its own claims fell — including that the deployed app cannot load a
catalogue at all (`data/catalog/` gitignored, live URL 404s, `sw.js` caches no data,
`a.schedule` read but never written). The multi-address feature has no data path in
production, which reordered the plan: publishing `dist/` is not the last step, it is what
makes the existing UI work.

Same failure shape as S2's, one level up: S2 assumed a *code* meant what it means
elsewhere; S3 assumed a *mechanism* worked because it was written down.

### S2 — 2026-08-01/02

Started by renaming the skill, then turned into the multi-address question and stayed
there. The research half went well and is all verified: both operators answer anonymously,
bulk enumeration works, GitHub Pages needs no backend, and the Ekonovus Power BI claim
from S1 ("needs a browser") was overturned.

The build half went badly, and the reason is worth keeping. **Every failure came from
assuming a code meant what it means elsewhere, then discovering it did not only after
shipping it:**

- Ekonovus municipality codes are its own, not the official LT ones — code 13 is Vilnius,
  not Druskininkai, so 50 321 Vilnius addresses were labelled "Druskininkų sav." Four more
  names were wrong the same way.
- Container-type infixes differ per municipality (`MK`/`P`/`S` vs `KA`/`SA`/`RA`), and
  Kauno **city** omits the municipality prefix entirely (`MK-BETARIS`), so reading a fixed
  position classified whole municipalities as OTHER.
- `build_index.py` deletes files, so running it after rebuilding one operator destroyed
  five Švara municipalities. `Kauno m. sav.` was lost this way twice and still does not
  show in the app.

Net effect: the catalogue was rebuilt **six times**. `tools/check_catalog.py` was written
in response and immediately caught a real bug (`MK-BETARIS`) — but it arrived after the
churn, not before it. The lesson is not "add a validator"; it is that a pipeline whose
steps delete each other's output cannot be run incrementally, and that guessing a code's
meaning is never cheaper than fetching one record and measuring it.

The UI work was solid but showed the same pattern in miniature: a glow that existed in CSS
at 7% opacity and was invisible on screen, a `position: relative` added later in the file
that silently unfixed the header, labels centred in a flex row rather than on the card.
Each was found by the user, not by me, because I checked that the code said the right
thing instead of checking what rendered.

*Older sessions: `CONTEXT-ARCHIVE.md`.*
