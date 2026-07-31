# BinDay

Waste collection schedule PWA for Žalgirio g. 8A, Juragiai. Answers one question —
*do the bins go out tonight?* — and exports the whole schedule to a calendar.

- **Live:** https://gerimantas.github.io/BinDay/
- **QR:** https://gerimantas.github.io/BinDay/qr.html — scan sheet, prints on white

## Containers

| Type | Container | Operator | Interval |
|------|-----------|----------|----------|
| MIXED | `52-MK-036668` | UAB Kauno švara | 14 days |
| PACKAGING | `52-P-22781` | Ekonovus | 21 days |
| GLASS | `52-S-24716` | Ekonovus | 84 days |

All three fall on Tuesdays in the current window, and coincide on 2026-08-04,
2026-10-27 and 2027-01-19.

## Files

| File | Purpose |
|------|---------|
| `index.html` | The whole app — markup, styles, schedule data, ICS export |
| `manifest.json` | PWA manifest |
| `sw.js` | Service worker, cache-first for offline use at the kerb |
| `icon-192.png`, `icon-512.png` | App icons |
| `qr.html`, `qr.png` | Scan sheet linking to the live app |

## Calendar export

The button writes a `.ics` file with one `VEVENT` per collection day and a `VALARM`
at `-PT7H`, which lands at 17:00 the previous day — matching the operator's
"put the bins out the evening before".

Each pickup is an explicit event rather than an `RRULE`. Švara's own feed uses
`FREQ=WEEKLY;INTERVAL=2;BYDAY=TU`, which cannot express the off-cycle runs that do
happen (the window before 2026-08 contained Monday pickups and an extra Wednesday
collection on 2026-07-22). A recurrence rule would silently drop those, and a missed
pickup is the one failure that actually matters. Event UIDs are stable per date, so
re-importing updates events instead of duplicating them.

## Updating the schedule

Dates are hardcoded in `index.html` under `CONTAINERS`, each with an `until` horizon.
Past that date the app says the schedule needs refreshing rather than inventing dates.
Coverage differs per operator — Švara publishes a rolling window, Ekonovus a fixed
forward count — so one container expiring before the others is normal.

To refresh, use the `atlieku-grafikai` skill (`C:\Users\retco\.ai-skills\atlieku-grafikai`),
which handles both operators and regenerates `data/Atlieku_isvezimo_grafikai.md`.

Švara needs no browser at all — it serves the whole 12-month calendar as an
unauthenticated PDF, which the skill parses in about two seconds:

```bash
curl -s "https://grafikai.svara.lt/api/download/EKzJW7DK" -o schedule.pdf
python <skill>/scripts/svara_from_pdf.py schedule.pdf
```

Ekonovus has no equivalent — its schedule lives inside a Power BI embed and has to be
driven in a browser.

After changing the dates, **bump `CACHE` in `sw.js`** — otherwise installed clients keep
serving the old schedule from cache.

**Pending as of 2026-07-31:** Švara has extended MIXED to 2027-10-12, six dates beyond
what this repo currently records.

## Stack

Single HTML file. No framework, no build step, no dependencies.
