# BinDay — Decisions

Architectural decisions and what was rejected, with the reasoning. Newest first.

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
