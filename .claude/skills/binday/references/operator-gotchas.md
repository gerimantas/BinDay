# Scraping gotchas — svara.lt and ekonovus.lt

Everything here is specific to these two operators. **The general firecrawl traps —
concurrency deadlocks, pinning the scrape id, `--node` vs `page.evaluate`, silent empty
results, REPL variable collisions — now live in the `firecrawl` skill.** Read that first;
this file only covers what is peculiar to these sites.

## Contents

- [Power BI's unfiltered default is a wrong answer that looks right](#power-bis-unfiltered-default-is-a-wrong-answer-that-looks-right)
- [Švara's calendar cannot be read from the DOM](#švaras-calendar-cannot-be-read-from-the-dom)
- [Švara's server functions are seroval-encoded](#švaras-server-functions-are-seroval-encoded)
- [The PDF is the fast path, and it has its own trap](#the-pdf-is-the-fast-path-and-it-has-its-own-trap)
- [Don't grep away your own output](#dont-grep-away-your-own-output)

---

## Power BI's unfiltered default is a wrong answer that looks right

This is the most dangerous failure in the whole workflow, because nothing about it looks
like a failure.

If a slicer fails to apply, the Ekonovus report does **not** error. It serves its default
unfiltered state — a complete, well-formed schedule for a real but unrelated container.
Observed: `13-L-300017` at Klausmylių vs. Piliarožių g. 20, **Biržų r. sav.**, whose dates
shift daily. Correct-looking dates, plausible intervals, no warning anywhere.

The only thing distinguishing a successful filter from a silent miss is the address and
inventory number reading back as the ones you asked for. `scrape_ekonovus.sh` takes an
expected-address fragment and exits 3 on mismatch; pass it.

Related: scraping `ekonovus.lt/aptarnavimo-grafikai/` itself returns cookie banners and
nothing else. The schedule is inside an embedded Power BI report — scrape that URL directly.
It needs ~8s to paint; a shorter wait yields an empty shell.

## Švara's calendar cannot be read from the DOM

After clicking *Išskleisti vežimo grafiką*, `react-day-picker` marks collection days with
styling that does **not** surface as `data-selected="true"`, and the accessibility tree
omits highlight state entirely. A `page.evaluate` query returns zero dates while they are
plainly visible on screen.

Worse, a regex over `className` matches the literal string `data-selected=true` inside
Tailwind variant names and returns confident nonsense.

Ask the model to read the highlighted days visually, then verify the intervals are
consistent — `build_schedule_md.py` does this and warns on irregularities.

## Švara's server functions are seroval-encoded

The JS bundle exposes real API paths (`/schedule/getschedule?wasteObjectId=…`), reached
through `/_serverFn/<hash>?payload=`. Sending plain JSON returns HTTP 500
`Seroval Error (step: 3)` — the payload is **seroval**-encoded (`toJSONAsync` shape
`{"t":<node>,"f":127,"m":[]}`), and so are responses (`fromJSON({t: body, f:127, m:[]})`).

With `npm i seroval` plus headers `x-tsr-serverFn: true` and
`accept: application/x-tss-framed, application/x-ndjson, application/json`, the chain
`getdistricts → getsubdistricts → getcities → getstreets → getcontracts → getschedule`
resolves an address to a `wasteObjectId` and returns the whole window in one call
(`pageSize` is ignored).

Worth the setup only when resolving a **new** address — it also yields the `hashedId`,
which unlocks the PDF path below for every later run.

## The PDF is the fast path, and it has its own trap

`/api/download/<hashedId>` returns the full 12-month calendar, unauthenticated, in about
two seconds. Cross-checked against a browser scrape: 24/24 dates agreed.

But `extract_text()` yields no dates — collection days are drawn as **red rectangles behind
the digits**, so the text layer contains every day number with no indication of which are
pickups. Match rects filled `(0.8431, 0.2275, 0.2275)` against the characters inside their
bounds.

Two things that bit the first implementation:

- The first red rect is the **legend swatch**, not a date.
- Months are a **4×3 grid running LIEPA→BIRŽELIS**, so a cell's month must be resolved by
  column *and* row. Matching on x alone assigns every row to its column's first month and
  produces a schedule spanning eight years. The interval warning catches this.

The ICS endpoint (`/api/calendar/download/<hashedId>`) carries only the next pickup as an
`RRULE`, plus two 1970 daylight-saving artefacts any date regex will happily return. Useful
for "when is the next one", useless for a full schedule — and an `RRULE` cannot express the
off-cycle pickups Švara does schedule.

## Don't grep away your own output

Filtering a background task's output with `grep -v` produced a 0-byte file that looked
exactly like "the scrape returned nothing". Write raw output first, filter when reading.
When a background file is empty, confirm the task actually finished (`wc -c`, the task
notification) before concluding the scrape failed.
