# Ekonovus — calling the Power BI report directly

Read this when you actually need to query Ekonovus, not before. `tools/fetch_ekonovus.py`
and `tools/fetch_dates_ekonovus_bulk.py` already implement everything here; this file exists
for when one of them breaks or a query shape stops resolving.

## The endpoint answers anonymously

No login, no token, no browser, no credits:

```
POST https://wabi-west-europe-d-primary-api.analysis.windows.net/public/reports/querydata?synchronous=true
Content-Type: application/json;charset=UTF-8
X-PowerBI-ResourceKey: d86dc3d4-e915-4460-b12e-c925d3ae6c75
```

The resource key is the `k` field of the base64 `r=` token in the embed URL, and is the
*only* credential — captured requests carry an empty `authorization` header. Responses are
**gzipped**; decompress before parsing or you get `UnicodeDecodeError: 0x8b`.

## Do not hand-write the query body

Use `tools/pbi_template.json` (catalogue) and `tools/pbi_dates_template.json` (dates) as
templates. They came from capturing the report's own `querydata` POSTs in a browser, and
carry `modelId`, `ApplicationContext` (DatasetId/ReportId/VisualId) and a set of `Where`
conditions (`Future`, `Rodomas tvarkaraštis`, `OverNextRun`, inventory-not-null) that the
report needs and that are tedious to reconstruct. Omitting `modelId` returns
`400 The field ModelId must be between 1 and 9.22e18`.

Model shape: entities `WasteObject` (`Adresas`, `Inventorinis nr.`), `ScheduleDates`
(`Datos`, `Future`, `OverNextRun`), `AllAddresses` (`District`). **`Datos` is a `Measure`,
not a `Column`** — as a Column it returns `CouldNotResolveSemanticQueryDefinition`.

## Always page — an unpaged response is silently short

`Binding.DataReduction.Primary.Window.Count` caps a response, and **a response at the cap is
truncated with no error, no flag and no short-response signal.** It once cost 33 420
containers (25% of Kauno r.), every missing one looking exactly like a normalisation failure
rather than a truncated fetch. Coverage went 74.7% → 99.5% once paged.

Page with the continuation token: the response's `RT` feeds back as
`Binding.DataReduction.Primary.Window.RestartTokens`. Keep requesting until a page returns
no `RT`, and treat hitting your page cap with a token still pending as an error.

**500 is not a server limit.** That figure came from the report's own UI and was recorded
here as the date query's hard cap; it is not. Measured 2026-08-03: `Count` of 2 000, 10 000
and 30 000 are all accepted for the date query, and a 20 000-row page costs the same ~66 s
as a 2 000-row one. `fetch_dates_ekonovus_bulk.py` now asks for 20 000 and pulls all of
Kauno r. in four requests.

The catalogue query is likewise not limited to 500 — ~5 000 rows arrive per 6 s — but it is
**not ordered by municipality**. Pages 0–1 came back almost entirely `13-*` (Biržai); Kaunas
(`52-*`, 24 194 containers) only appeared on page 2. Never conclude a container is absent
from fewer than all pages.

## A query costs ~10 s no matter how little it returns

This is what makes the request *shape* matter more than the row count. Measured on
localities not previously queried: 4 rows took 12.1 s, 443 rows took 13.7 s. The cost is
`Datos` being evaluated across the national table per request, not the rows travelling back.

So many small questions are far worse than few large ones — asking per locality took ~65 min
for Kauno r. (266 requests), while four prefix-filtered pages take ~1.5 min for the same
data, verified identical bar the sliding horizon.

Three shapes measured and rejected 2026-08-03, so they are not re-tried:

- **Batching localities** into one `Or` of `Contains`: no gain at all (~6.3 s per locality
  whether batched 5, 10 or 25). Same server work, one response.
- **No filter at all:** HTTP 500. The report will not evaluate `Datos` unfiltered, so a
  filter of some kind is required, not merely helpful.
- **All 13 prefixes present in Kauno r. as one `Or` chain:** also HTTP 500 (too many
  conditions). Fetched separately they took 13.5 min for 281 098 national rows of which
  3 308 were in Kauno r. — **a prefix is a collection route, not a municipality**, and the
  same route spans the country.

## Responses are dictionary- and delta-encoded

Do not hand-roll the decoder — use `tools/pbi_decode.py`:

```bash
python tools/pbi_decode.py response.json     # response must already be gunzipped
```

```python
from pbi_decode import decode, decode_response
rows = decode(ds)                    # one DS -> [(addr, inv), ...]
```

The format: the first `DM0` row carries the schema in `S` (each entry's `DN` names its
dictionary). Every later row is a **delta against the previous row** — `R` is a repeat
bitmask (bit *i* set → field *i* unchanged and absent from `C`), `Ø` is a null bitmask, and
`C` supplies only the fields whose `R` bit is clear, in order. Getting the bitmask direction
wrong yields rows that look plausible but pair the wrong address with the wrong container.
Verified 60 000 rows decoded with zero null fields.

## Inventory numbers carry a singular type suffix

The dataset stores `52-P-22781 (Pakuotė)` and `52-S-24716 (Stiklas)` — not the bare number,
and not the plural `(Pakuotės)` that the report's own labels use elsewhere. An exact-match
filter on the bare number silently returns **0 rows**, not an error. Read the exact string
out of the inventory list before filtering on it.

## Filtering by address

A `Contains` condition on `WasteObject.Adresas` returns just that address's containers in
~7 s:

```json
{"Condition":{"Contains":{
  "Left":{"Column":{"Expression":{"SourceRef":{"Source":"w"}},"Property":"Adresas"}},
  "Right":{"Literal":{"Value":"'Žalgirio g. 8A'"}}}}}
```

A street name alone is **not unique nationally** — that query returns both
`Juragių k. Žalgirio g. 8A` and `Radviliškio m. Žalgirio g. 8A`. Always match the locality
too.

Address+inventory (no `Datos` measure) is fast; adding `Datos` is far slower, which is why
the pipeline enumerates the catalogue first and fetches dates as a separate pass. That pass
filters on the inventory prefix (`StartsWith`), not the address — the address filter is what
forced the old per-locality loop.

One query can return address, inventory number and the whole date list together:

```
D0: ["Juragių k. Žalgirio g. 8A"]
D1: ["52-P-22781 (Pakuotė)"]
D2: ["2026-08-04, 2026-08-25, 2026-09-15, …"]   ← one comma-joined string, trailing "."
```

## The browser path, still the fallback

```bash
bash scripts/scrape_ekonovus.sh 52-P-22781
```

`ekonovus.lt/aptarnavimo-grafikai/` is a WordPress shell — scraping it yields cookie banners
and nothing else. The real content is an embedded Power BI report; scrape that URL directly
(baked into the script). It needs ~8 s to paint; a shorter wait returns an empty shell.

The report has three slicers: Savivaldybė, Konteinerio adresas, Inventorinis numeris. Filter
by **inventory number** — addresses in the report are free-text and often formatted
differently than the official one.

**Always read the address back before trusting the dates**, by either path. See
`operator-gotchas.md` for why: an unapplied slicer serves a real but unrelated container's
complete schedule with no error at all.

## Ekonovus municipality codes are its own, not the official LT ones

Code 13 is Vilnius here, while the official 13 is Druskininkai — 50 321 Vilnius addresses
once shipped labelled "Druskininkų sav." Codes 84, 74, 75 and 66 were wrong too. Name a file
from its own most common locality rather than from a code table.
