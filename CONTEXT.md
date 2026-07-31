# BinDay — Context

## Status

**active** — 2026-07-31 (S1)

Waste collection schedule PWA, live at https://gerimantas.github.io/BinDay/ and
installable to a phone home screen. Answers one question — do the bins go out tonight —
and exports the whole schedule to a calendar with reminders at 17:00 and 20:00 the
evening before.

Built this session from scratch: scraped both operators, produced the canonical markdown,
then the app. Repo has 7 commits, everything pushed. The old `atlieku_isv_grafikai` data
folder was folded into `BinDay/data/`.

Three containers at Žalgirio g. 8A, Juragiai — all collected on Tuesdays:

| Type | Container | Operator | Interval | Published until |
|------|-----------|----------|----------|-----------------|
| MIXED | `52-MK-036668` | UAB Kauno švara | 14 d | 2027-07-20 |
| PACKAGING | `52-P-22781` | Ekonovus | 21 d | 2027-03-23 |
| GLASS | `52-S-24716` | Ekonovus | 84 d | 2027-07-06 |

## Next Tasks

- **Second calendar reminder does not survive Google import.** Google Calendar keeps only
  the first `VALARM` from an imported ICS, so the 20:00 alert is dropped and only 17:00
  shows. Fix by creating a dedicated `BinDay` calendar in Google with two default event
  notifications (1 day before at 17:00 and at 20:00) and importing into it — the file
  itself is correct and needs no change. Alternative if that's unwanted: emit two timed
  events on the evening before instead of one all-day event.
- **Refresh the schedule — Švara has extended MIXED to 2027-10-12**, six dates beyond what
  `data/Atlieku_isvezimo_grafikai.md` records. Use the `atlieku-grafikai` skill; the fast
  path is the unauthenticated PDF endpoint, not the browser. After regenerating, update
  `CONTAINERS` in `index.html` and bump `CACHE` in `sw.js`.
- Consider a `pwa-single-file` skill once a third PWA exists — this session re-solved
  service-worker cache bumps, the iOS `apple-touch-icon` requirement, and two date bugs
  that the Grafikai project had already hit.
- Consider an `ics-calendar` skill covering the three undocumented client limits found
  here: Google keeps one VALARM, Google ignores `COLOR:`, and RRULE cannot express
  off-cycle dates.

## Done Log

- Created the app: single-file PWA, neon palette (red/yellow/green per waste type),
  expandable schedule list, ICS export, QR scan sheet, PWA icons.
- Created the `atlieku-grafikai` skill and hardened it through a 6-agent eval that found
  8 real defects, including a silent bug where `firecrawl interact` without `-s` attaches
  to another agent's browser session.
- Extended the `firecrawl` skill with the general lessons: pinning the scrape id, the
  concurrency deadlock, `--code` returning the last expression while `console.log` is
  swallowed, and a `--node` example that could not have worked as written.
- Put the 48-skill library under version control at `github.com/gerimantas/ai-skills`
  (private). Excluded a 105 MB bundled virtualenv; the repo is 7.4 MB.

## Key Facts

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

### S1 — 2026-07-31

Started from a text file listing three container numbers and two operator URLs. Scraped
both sites (Švara is a TanStack SPA whose calendar cannot be read from the DOM; Ekonovus
hides its schedule in a Power BI embed), produced `Atlieku_isvezimo_grafikai.md`, then
built and deployed the app.

Corrected a transcription error along the way: the mixed-waste container is `52-MK-036668`,
not `52-MK-03668` as the original notes had it.

Also overturned an earlier conclusion from this same session — I had reported the schedule
intervals as fixed and safe to extrapolate. An eval agent scraping the full window found
Monday pickups and an extra Wednesday collection in the preceding period. The app and the
generator were changed to store published dates rather than compute them.
