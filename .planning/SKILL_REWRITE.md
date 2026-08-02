# Rewriting the `binday` skill after S4

Written 2026-08-03 at the end of S4. The skill lives at `C:\Users\retco\.ai-skills\binday`
(495-line `SKILL.md` + `references/operator-gotchas.md` + `scripts/`).

**This is not a tidy-up. The skill instructs commands that were deleted this session**, and
it triggers on phrases like "atnaujink grafikus" — so the next person to ask for a refresh
gets led into tooling that no longer exists.

## 1. What is actively wrong

Verified by grep against the skill on 2026-08-03:

| `SKILL.md` says | Reality after S4 |
|---|---|
| `python tools/build_index.py` (line 412) | **Deleted.** It removed files it had not created and lost `Kauno m. sav.` twice |
| `python tools/check_catalog.py` (413, 416) | **Deleted** with the layout it targeted |
| `--out data/catalog` (410–411) | Directory gone; superseded by `data/raw/` + `dist/` |
| "update the `CONTAINERS` array in its `index.html`" (49) | `index.html` is **generated**. Edit `src/`, run `tools/build_app.py` |
| `Atlieku_isvezimo_grafikai.md` is the canonical source (25–26) | Orphaned — nothing reads it (see the separate Next Task about deleting it) |
| "Unless the user names a different address, assume this one" (33) | The app serves 40 959 Kauno r. addresses, each with its own dates |
| "Known pending refresh (as of 2026-07-31)… six dates beyond" (45–49) | Long since fetched; the pipeline refreshes monthly |
| Manual scraping is the main workflow (63–87) | Automated: `refresh.yml` monthly behind `precheck.py`, `health.yml` weekly |

## 2. What the skill must now say instead

### The merge key — currently absent entirely

`(locality, street, house, flat)`. All four. Include **why**, because two earlier recorded
rules said the opposite and a reader may meet those first:

- locality: 1 406 of 1 442 multi-locality street+house keys have **different dates**
  (Švara 12/12)
- flat: all 3 746 multi-flat buildings assign containers per flat; **60%** of Švara ones
  differ in dates
- the transferable rule: **verify a key against what it selects, not against how often it
  matches.** An overlap percentage cannot distinguish a merged duplicate from a wrong
  schedule, which is how the wrong rule survived three sessions.

Full numbers: [[wiki/bin-day/merge-key-s4]].

### Three traps not in the skill at all

- **`getschedule` takes `wasteObjectId`, not `hashedId`.** The skill mentions `hashedId`
  throughout. `getschedule` returns an *empty result* for it under every parameter name —
  no error. `getcontracts` returns both; carry both.
- **The Power BI date query has a 500-row window and must be paged** with `RestartTokens`.
  Truncation is silent and looks exactly like a normalisation miss. Cost 33 420 containers
  (25% of the municipality) before it was caught.
- **Every Švara `getcontracts` filter is `Contains`, not equality.** `houseNumber=5`
  returns `15-1`, `35`, `15C`, `3-5`. Send all five fields and read `fullAddress` back.
  (This one *was* added to the skill in S4 — verify it survived the rewrite.)

### The skill's job has changed

From *"here is how to scrape"* to *"here is how to diagnose a refresh that failed, and how
the pipeline is shaped"*. The scraping detail is still needed, but as reference for when
the automation breaks — not as the primary workflow.

New primary commands:

```bash
python tools/precheck.py       # 0 unchanged, 10 changed, 1 could-not-tell
python tools/build_dist.py     # raw/ -> dist/
python tools/check_dist.py     # publish gate, must pass before committing dist/
python tools/build_app.py      # src/ -> index.html, bumps sw.js CACHE
gh run list --workflow="Refresh schedules"
```

## 3. Size

470 lines / 25.7 KB loaded on every trigger. The Power BI call-shape section is 93 lines
(20%) needed only when actually calling Ekonovus — move it to `references/` alongside
`operator-gotchas.md`. Target ~380 lines, and the S4 additions should not push it back up:
put the pipeline shape in `references/` too if it does.

## 4. Order of work

1. Delete or correct the eight rows in section 1 first — those are the harmful ones.
2. Add the merge key and the three traps.
3. Re-point the workflow at the automation, keeping manual scraping as fallback.
4. Split to `references/` last, once the content is right.
5. Run the evals in `C:\Users\retco\Projects\BinDay\.evals\` — they were how this skill was
   hardened originally (a 6-agent eval found 8 real defects). Check first whether they
   still assert anything true; several probably test the single-address world.
6. Regenerate the index: `python C:/Users/retco/.ai-skills/_regen-index.py`.

## 5. Sources

- [[wiki/bin-day/merge-key-s4]] — the key and the measurements behind it
- [[wiki/bin-day/data-pipeline]] — `raw/` → `dist/`, the gate, the traps
- `DECISIONS.md` — S4 entry; superseded rules marked in place
- `.planning/PIPELINE_PLAN.md` — all ten steps as executed, with what execution corrected
