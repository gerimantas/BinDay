# BinDay — Context Archive

Older session entries, moved out of `CONTEXT.md` to keep the session-start injection small.
Newest first.

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
