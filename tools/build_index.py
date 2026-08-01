#!/usr/bin/env python3
"""Merge both operators' catalogues into the index the app fetches first.

    python tools/build_index.py

Writes data/catalog/areas.json listing every municipality either operator serves, and
prunes the per-municipality files down to the ones the app actually ships.

**Only municipalities served by both operators are shipped.** A single-operator area
shows a partial picture — Klaipėdos r. would list packaging and glass but no mixed waste,
Vilnius the reverse — and a schedule that silently omits a bin is worse than no schedule,
because the user trusts it and misses a collection. Those areas stay in the index marked
`pending` so the app can say "data is being prepared" instead of showing half a schedule.

Municipality names come from Švara directly; for Ekonovus they are derived from the
container-number prefix, which is the official municipality code. A handful of rows carry
a prefix that disagrees with their address (a Pasvalys address numbered `23-*`), so a code
is never treated as authoritative on its own.
"""

import glob
import io
import json
import os
import sys
import time

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8")
    except (AttributeError, ValueError):
        pass

CATALOG = "data/catalog"


def collect():
    areas = {}
    for pattern, operator in (("svara-*.json", "Švara"), ("ekonovus-*.json", "Ekonovus")):
        for path in sorted(glob.glob(os.path.join(CATALOG, pattern))):
            base = os.path.basename(path)
            if base in ("index.json", "svara-index.json", "areas.json"):
                continue
            d = json.load(io.open(path, encoding="utf-8"))
            a = areas.setdefault(d["municipality"],
                                 {"municipality": d["municipality"], "files": []})
            a["files"].append({"operator": operator, "file": base, "count": d["count"],
                               "path": path})
    return areas


def main():
    prune = "--keep-all" not in sys.argv
    areas = collect()

    shipped, pending = [], []
    for name, a in areas.items():
        operators = sorted({f["operator"] for f in a["files"]})
        total = sum(f["count"] for f in a["files"])
        entry = {"municipality": name, "operators": operators, "containers": total}
        if len(operators) == 2:
            entry["files"] = [{k: f[k] for k in ("operator", "file", "count")}
                              for f in a["files"]]
            shipped.append(entry)
        else:
            entry["pending"] = True
            pending.append(entry)

    shipped.sort(key=lambda e: -e["containers"])
    pending.sort(key=lambda e: -e["containers"])

    payload = {
        "generated": time.strftime("%Y-%m-%d"),
        "shipped": shipped,
        "pending": pending,
        "totalContainers": sum(e["containers"] for e in shipped),
    }
    with io.open(os.path.join(CATALOG, "areas.json"), "w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False, indent=1)

    keep = {f["file"] for e in shipped for f in e["files"]} | {"areas.json"}
    print(f"shipped ({len(shipped)} areas, both operators):")
    for e in shipped:
        print(f"   {e['municipality']:<24} {e['containers']:>7}")
    print(f"pending ({len(pending)} areas, one operator only) — app warns, ships no data")

    if prune:
        # Only ever prune files this run actually saw. Deleting on the strength of a
        # partial catalogue is how five Švara municipalities were lost: a run made after
        # rebuilding Ekonovus alone deleted every Švara file that was not in a
        # both-operator pairing, and the next run could no longer even list them as
        # pending, so Kauno m. sav. silently vanished from the app's picker.
        seen = {f["file"] for a in areas.values() for f in a["files"]}
        removed = 0
        for path in glob.glob(os.path.join(CATALOG, "*.json")):
            base = os.path.basename(path)
            if base in keep or base not in seen:
                continue
            os.remove(path)
            removed += 1
        print(f"pruned {removed} single-operator files")
    size = sum(os.path.getsize(p) for p in glob.glob(os.path.join(CATALOG, "*.json")))
    print(f"catalog now {size/1e6:.1f} MB")


if __name__ == "__main__":
    main()
