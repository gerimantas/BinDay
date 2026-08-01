#!/usr/bin/env python3
"""Sanity-check the built catalogue before it ships.

    python tools/check_catalog.py

Every check here exists because the corresponding bug shipped silently at least once in
this project — none of them raised an error at build time, and each produced output that
looked entirely reasonable. Exits non-zero if any check fails, so it can gate a commit.
"""

import glob
import io
import json
import os
import re
import sys
from collections import Counter

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8")
    except (AttributeError, ValueError):
        pass

CATALOG = "data/catalog"
OTHER_LIMIT = 0.02      # >2% unclassified means an infix table is out of date
NO_ID_LIMIT = 0.02      # a few rows legitimately lack a container number


def load():
    files = {}
    for path in sorted(glob.glob(os.path.join(CATALOG, "*.json"))):
        base = os.path.basename(path)
        # areas.json is the merged index; index.json / svara-index.json are the
        # fetchers' own summaries. None of them holds entries, so none is a catalogue.
        if base in ("areas.json", "index.json", "svara-index.json"):
            continue
        d = json.load(io.open(path, encoding="utf-8"))
        if "entries" not in d:
            continue
        files[base] = d
    return files


# A rural municipality's own name appears in none of its addresses — Kauno r. sav. is all
# Garliavos, Domeikavos, Ringaudų. So the check needs a known locality per file rather
# than the municipality name itself; without one it would cry wolf on every rural area.
WITNESS = {
    "ekonovus-13.json": "Vilniaus",
    "ekonovus-49.json": "Kaišiadorių",
    "ekonovus-52.json": "Garliavos",
    "svara-vilniaus-m-sav.json": "Vilniaus",
    "svara-kaišiadorių-r-sav.json": "Kaišiadorių",
    "svara-kauno-r-sav.json": "Juragių",
    "svara-kauno-m-sav.json": "Kauno",
}


def check_name_matches_addresses(base, d, fail, warn):
    """A shipped file must contain the locality we expect for its municipality.

    Code 13 was labelled "Druskininkų sav." while all 50 321 addresses were Vilnius —
    a silent mislabel that routes users to another city's schedule.
    """
    witness = WITNESS.get(base)
    if not witness:
        warn(f"{base}: no witness locality registered — name unverified")
        return
    stem = witness[:5].lower()
    hit = any(str(e[0]).strip().lstrip(".").split(" ")[0][:5].lower() == stem
              for e in d["entries"])
    if not hit:
        common = Counter(str(e[0]).strip().lstrip(".").split(" ")[0]
                         for e in d["entries"]).most_common(1)
        fail(f"{base}: claims {d.get('municipality')!r} but holds no {witness!r} "
             f"address (commonest: {common[0][0]!r}) — code mapping has shifted")


def check_types(base, d, fail, warn):
    """Too many OTHER means a container-infix is unmapped — grey dots in the app."""
    types = Counter(e[2] for e in d["entries"])
    other = types.get("OTHER", 0)
    if d["count"] and other / d["count"] > OTHER_LIMIT:
        infixes = Counter()
        for e in d["entries"]:
            if e[2] == "OTHER":
                parts = str(e[1]).split("-")
                if len(parts) > 1:
                    infixes[parts[1]] += 1
        top = ", ".join(f"{k}×{v}" for k, v in infixes.most_common(4))
        fail(f"{base}: {other}/{d['count']} containers are OTHER "
             f"({other/d['count']:.0%}) — unmapped infixes: {top or 'n/a'}")
    elif other:
        warn(f"{base}: {other} OTHER containers")


def check_rows(base, d, fail, warn):
    missing_addr = sum(1 for e in d["entries"] if not isinstance(e[0], str) or not e[0].strip())
    if missing_addr:
        fail(f"{base}: {missing_addr} rows have no address")

    no_id = sum(1 for e in d["entries"] if not isinstance(e[1], str) or not e[1].strip())
    if d["count"] and no_id / d["count"] > NO_ID_LIMIT:
        fail(f"{base}: {no_id}/{d['count']} rows have no container number")
    elif no_id:
        warn(f"{base}: {no_id} rows have no container number")

    if len(d["entries"]) != d["count"]:
        fail(f"{base}: count says {d['count']} but holds {len(d['entries'])} entries")

    # Švara rows carry a hashedId; without it the schedule cannot be fetched later.
    if base.startswith("svara-"):
        no_hash = sum(1 for e in d["entries"] if len(e) < 4 or not e[3])
        if no_hash:
            fail(f"{base}: {no_hash} rows have no hashedId")


def check_index(files, fail, warn):
    path = os.path.join(CATALOG, "areas.json")
    if not os.path.exists(path):
        fail("areas.json is missing — run tools/build_index.py")
        return
    idx = json.load(io.open(path, encoding="utf-8"))

    referenced = {f["file"] for a in idx.get("shipped", []) for f in a["files"]}
    for f in sorted(referenced - set(files)):
        fail(f"areas.json points at {f}, which is not on disk")
    for f in sorted(set(files) - referenced):
        warn(f"{f} is on disk but not shipped — build_index.py will prune it")

    # Every shipped area must genuinely have both operators, or the app shows half a
    # schedule while implying it is complete.
    for a in idx.get("shipped", []):
        ops = {f["operator"] for f in a["files"]}
        if len(ops) < 2:
            fail(f"areas.json ships {a['municipality']!r} with only {ops}")


def main():
    files = load()
    if not files:
        print("no catalogue files found — run the fetchers first", file=sys.stderr)
        return 1

    problems, warnings = [], []
    fail = problems.append
    warn = warnings.append

    for base, d in files.items():
        check_name_matches_addresses(base, d, fail, warn)
        check_types(base, d, fail, warn)
        check_rows(base, d, fail, warn)
    check_index(files, fail, warn)

    total = sum(d["count"] for d in files.values())
    print(f"{len(files)} files, {total} containers")
    for w in warnings:
        print(f"  warn: {w}")
    for p in problems:
        print(f"  FAIL: {p}", file=sys.stderr)
    print("OK" if not problems else f"{len(problems)} problem(s)")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
