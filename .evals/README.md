# Eval scenarios for the `binday` skill

Five executable scenarios used to check the skill still works after it is edited:

| # | Name | What it checks |
|---|------|----------------|
| 0 | `refresh-schedules` | Refreshes via the pipeline and the gate, not by hand, and not into the orphaned markdown |
| 1 | `diagnose-low-coverage` | Reads a one-operator shortfall as truncated paging, not normalisation |
| 2 | `merge-key-pressure` | Holds the four-part key under a plausible request to collapse it |
| 3 | `verify-single-address` | Refuses an ambiguous address; reads `fullAddress` back |
| 4 | `app-edit-and-cache` | Edits `src/`, rebuilds, accounts for the service worker cache |

Run them with the `ai-tester` skill against `C:\Users\retco\.ai-skills\binday`.

These scenarios assert **behaviour under pressure**, not schedule contents, so they do not
go stale as dates advance. That is deliberate: the previous set asserted a next-pickup date
relative to 2026-07-31 and required regenerating `Atlieku_isvezimo_grafikai.md` with an
`anchor + intervalDays` JS block — by S4 those assertions demanded the opposite of what the
skill now correctly says, so a failure there meant the eval was wrong, not the skill.

Scenarios 1–3 encode failures that actually happened and cost real time (the Power BI
500-row window, the street+house merge rule, `Contains` filters). If one starts passing
trivially, check that the skill still *states* the reason rather than having quietly lost it.

Run outputs are not kept. The first run (2026-07-31, 6 agents) found 8 real defects; those
findings live in `SKILL.md` and `references/`, which is the durable form. The raw output
tree was 296K of duplicated schedule markdown and a benchmark summary that failed to
populate, so it was dropped rather than committed.
