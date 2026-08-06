# BinDay — Context Archive

Older session entries, moved out of `CONTEXT.md` to keep the session-start injection small.
Newest first.

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
