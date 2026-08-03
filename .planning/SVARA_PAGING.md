# Švara catalogue paging — open, and how to finish it cheaply

Written 2026-08-03 (S5), mid-investigation, deliberately before the fix. The
defect is understood; the fix is not, and the previous four attempts each cost a
~40-minute full pipeline run to learn something a ten-second probe would have
told us. **Do not start with a full fetch.**

## The defect

`fetch_svara.js` ended each subdistrict's paging on:

```js
if (page + 1 >= (r.totalPages || 0)) break;   // original
```

`totalPages` is absent (or 0) in the response, and `|| 0` makes the condition
true on page 0, so every subdistrict stopped after one page. Measured 2026-08-03:
the Kauno r. catalogue fell 58 477 → 52 483 with **no error**, MIXED down 5 551,
and 24 of 26 subdistricts byte-identical — only Užliedžių (7 471 → exactly 2 000)
and Vandžiogalos (523 → 0) were affected, because the rest fit in one page.

That much is confirmed and is not in doubt.

## Why the current fix is wrong

It was changed to stop on a short page:

```js
if (got < PAGE_SIZE) break;                   // current, still wrong
```

Locally this restores 58 477 exactly, all 26 subdistricts matching the 2026-08-02
baseline. **On the runner the same code produced 54 306** — Garliavos sen.
returned 1 000 rows (exactly PAGE_SIZE) and stopped, against 5 171 locally.

So the server sometimes serves a full page followed by something the loop reads
as "done". Same code, same data, different result — which means the stop
condition depends on server behaviour that is not stable.

## The next step, and it is small

**Three `getcontracts` calls against one subdistrict. No catalogue, no `raw/`
write, ~10 seconds.** Page 0, 1 and 2 of `Garliavos sen.` at `pageSize=1000`,
printing for each: row count, `totalPages`, `totalRecords`.

That distinguishes the only hypotheses worth holding:

| If page 1 returns | Then |
|---|---|
| 0 rows, but page 2 has rows | the server serves an empty page mid-sequence; stop on *two* consecutive empties, or drive by `totalRecords` |
| rows, consistently | the runner hit a transient failure the loop swallowed; the fix is retry + a post-fetch total assertion, not a different stop condition |
| an error the loop ate | the `catch` is too broad — a failed page must abort the subdistrict, not end it |

`totalPages`/`totalRecords` **are** present in the response — an earlier probe in
this session concluded they were absent, but that was a regex failing on the
seroval encoding (`{"t":0,"s":0}`), not the fields being missing. Read them
properly before assuming they are unusable; if they are reliable, they are a
better stop condition than counting rows.

## The rule this file exists to enforce

Whatever the answer, **assert the total after the fetch and refuse to write a
short catalogue.** Every silent truncation in this project — this one, the
Ekonovus 500-row window, the unpaged date query — looked exactly like the
operator having less data. A count check at the end is the only thing that
distinguishes them, and it costs nothing.

`fetch_svara.js` already refuses to write when more than one subdistrict comes
back empty. That is the same idea and it should be extended to the total.

## Do not re-derive

- Ekonovus dates now take four requests (~1.5 min), not 266 (~65 min). Done and
  verified on the runner. See `tools/fetch_dates_ekonovus_bulk.py`.
- `PYTHONUNBUFFERED: '1'` is set in both workflows. Without it a cancelled run's
  log is empty and the failure gets diagnosed by guesswork — which is how the
  2026-08-02 timeout was recorded as "hung" when it was merely slow.
- The publish gate compares **waste types per address**, not container ids:
  Švara renumbers containers in place (52-MK-027475 → 52-MK-027475SENAS, 31 in
  one day) and Ekonovus lists nine containers twice. Both read as loss under an
  id comparison. Verified both directions.
- `descriptionPlural` is **not** interchangeable with `description`. It says
  "mišrių atliekų" for containers whose `description` says "Žaliųjų atliekų".
  Concatenating them reclassified 194 GREEN as MIXED while fixing 56. The order
  is description → inventory infix → descriptionPlural, and the container total
  does not reveal the damage — only the per-type counts do.

## State as of writing

`dist/` in the repo is sound: 40 959 addresses, all types present, gate passes.
No failed run published anything. The scheduled monthly refresh already fires
correctly (2026-08-03 05:27, pre-check said unchanged, stopped in 24 s), so
nothing is urgent — but the next forced refresh will still produce a short Švara
catalogue and be blocked by the gate.
