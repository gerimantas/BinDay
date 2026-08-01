# Eval scenarios for the `binday` skill

Three executable scenarios used to check the skill still works after it is edited:

| # | Name | What it checks |
|---|------|----------------|
| 0 | `full-refresh` | Scrapes both operators and regenerates the canonical markdown |
| 1 | `next-pickup-lookup` | Answers from local data **without** opening a browser |
| 2 | `add-new-container` | Adds a container without duplicating an existing one |

Run them with the `ai-tester` skill against `C:\Users\retco\.ai-skills\binday`.

Scenario 1 asserts dates relative to **2026-07-31** (next MIXED pickup `2026-08-04`). Those
assertions go stale as the schedule advances — update them, don't treat a failure there as a
skill regression.

Run outputs are not kept. The first run (2026-07-31, 6 agents) found 8 real defects; those
findings live in the skill's `SKILL.md` and `references/operator-gotchas.md`, which is the
durable form. The raw output tree was 296K of duplicated schedule markdown and a benchmark
summary that failed to populate, so it was dropped rather than committed.
