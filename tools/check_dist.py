#!/usr/bin/env python3
"""Gate dist/ before it is published. Exits non-zero if anything fails.

    python tools/check_dist.py
    python tools/check_dist.py --previous <dir>   # also compare against a prior build

A failing check must abort the publish, leaving the previous dist/ live. Every
check here exists because the corresponding bug either shipped silently in this
project or was measured to be possible — none of them raises an error at build
time, and each produces output that looks entirely reasonable.

This is a new checker rather than an extension of check_catalog.py, which is
written against data/catalog/ with index.json/svara-index.json/areas.json
hardcoded — a layout this pipeline replaces. Maintaining assertions for two
incompatible shapes at once is how both drift.
"""

import hashlib
import io
import json
import os
import sys
from collections import Counter

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8")
    except (AttributeError, ValueError):
        pass

DIST = "dist"
OTHER_LIMIT = 0.02        # >2% unclassified means a container infix is unmapped
MIN_ADDRESSES = 30000     # Kauno r. built 40 960; a collapse to a few thousand is a bug

# A rural municipality's own name appears in none of its addresses — Kauno r. is
# all Garliavos, Domeikavos, Ringaudų. So the witness is a locality we know is
# there, not the municipality name, or the check cries wolf on every rural area.
WITNESS = {"kauno-r-sav": ["jurag", "garliav", "domeikav"]}

# The app's own address. If this breaks, the one user we have is looking at a
# wrong schedule.
KNOWN = {
    "area": "kauno-r-sav",
    "key": "jurag|zalgirio g|8a|",
    "types": {"MIXED", "PACKAGING", "GLASS"},
    "ids": {"52-MK-036668", "52-P-22781", "52-S-24716"},
}

# Addresses that must NOT be fused, with the measurement that says so.
# Each of these passes every other check while being silently wrong.
NO_COLLAPSE = [
    {
        "area": "kauno-r-sav", "street": "saules g", "house": "5",
        "min_distinct": 15, "why": "locality: 1 406 of 1 442 multi-locality "
                                   "street+house keys have different dates",
    },
    {
        "area": "kauno-r-sav", "street": "pastotes g", "house": "7",
        "locality": "birulisk", "min_flats": 5,
        "why": "flat: 60% of Švara multi-flat buildings differ; flat 4 here is "
               "on a different glass schedule from its neighbours",
    },
]


def load(path):
    return json.load(io.open(path, encoding="utf-8"))


def main():
    previous = None
    if "--previous" in sys.argv:
        previous = sys.argv[sys.argv.index("--previous") + 1]

    problems, warnings = [], []
    fail, warn = problems.append, warnings.append

    if not os.path.isdir(DIST):
        print(f"FAIL: {DIST}/ does not exist — run tools/build_dist.py",
              file=sys.stderr)
        return 1

    # ---- top-level files exist and parse
    for name in ("areas.json", "version.json"):
        p = os.path.join(DIST, name)
        if not os.path.exists(p):
            fail(f"{name} is missing")
            continue
        try:
            load(p)
        except ValueError as e:
            fail(f"{name}: not valid JSON ({e})")
    if problems:
        return report(problems, warnings)

    areas = load(os.path.join(DIST, "areas.json"))
    version = load(os.path.join(DIST, "version.json"))

    if not areas.get("areas"):
        fail("areas.json ships no areas")
        return report(problems, warnings)

    total_addresses = 0
    for a in areas["areas"]:
        slug = a["slug"]

        # ---- every file named in areas.json exists. An index that lies is
        # worse than none, because every later step trusts it.
        for f in a.get("files", []):
            p = os.path.join(DIST, slug, f)
            if not os.path.exists(p):
                fail(f"areas.json names {slug}/{f}, which is not on disk")
                continue
            try:
                load(p)
            except ValueError as e:
                fail(f"{slug}/{f}: not valid JSON ({e})")
        if problems:
            continue

        # data.json's signature is what clients compare to decide whether to
        # re-download. If it does not match the file, an edited build ships and
        # every client keeps the old copy, believing it current.
        sig = version.get("areas", {}).get(slug)
        if not sig:
            fail(f"version.json has no signature for {slug} — clients cannot "
                 f"tell when it changes")
        else:
            text = io.open(os.path.join(DIST, slug, "data.json"),
                           encoding="utf-8").read()
            actual = hashlib.sha256(text.encode("utf-8")).hexdigest()[:16]
            if actual != sig:
                fail(f"{slug}: version.json signature {sig} does not match "
                     f"data.json ({actual}) — clients would keep a stale copy")

        data = load(os.path.join(DIST, slug, "data.json"))
        index = load(os.path.join(DIST, slug, "index.json"))
        addr = data.get("addresses", {})
        total_addresses += len(addr)

        if not addr:
            fail(f"{slug}: data.json has no addresses")
            continue
        if a.get("addresses") != len(addr):
            fail(f"{slug}: areas.json says {a.get('addresses')} addresses, "
                 f"data.json holds {len(addr)}")
        if len(addr) < MIN_ADDRESSES:
            fail(f"{slug}: only {len(addr)} addresses, expected at least "
                 f"{MIN_ADDRESSES} — a parse regression collapses this silently")

        check_witness(slug, addr, fail, warn)
        check_types(slug, addr, fail, warn)
        check_index_agrees(slug, addr, index, fail, warn)
        check_no_collapse(slug, addr, fail, warn)

    check_known(areas, fail, warn)

    if previous:
        check_against_previous(previous, areas, fail, warn)

    print(f"{len(areas['areas'])} area(s), {total_addresses} addresses")
    return report(problems, warnings)


def check_witness(slug, addr, fail, warn):
    """The area must contain a locality we know belongs to it."""
    witnesses = WITNESS.get(slug)
    if not witnesses:
        warn(f"{slug}: no witness locality registered — name unverified")
        return
    localities = {k.split("|", 1)[0] for k in addr}
    hit = [w for w in witnesses if w in localities]
    if not hit:
        common = Counter(k.split("|", 1)[0] for k in addr).most_common(3)
        fail(f"{slug}: holds none of {witnesses} (commonest: "
             f"{[c[0] for c in common]}) — the area mapping has shifted")


def check_types(slug, addr, fail, warn):
    """Too many OTHER means an unmapped container infix — grey dots in the app."""
    types = Counter(c[1] for rows in addr.values() for c in rows)
    total = sum(types.values())
    other = types.get("OTHER", 0)
    if total and other / total > OTHER_LIMIT:
        fail(f"{slug}: {other}/{total} containers are OTHER ({other/total:.0%}) "
             f"— a container infix is unmapped")
    elif other:
        warn(f"{slug}: {other} OTHER containers")
    for required in ("MIXED", "PACKAGING", "GLASS"):
        if not types.get(required):
            fail(f"{slug}: no {required} containers at all — one operator's "
                 f"data is missing")


def check_index_agrees(slug, addr, index, fail, warn):
    """Every address must be reachable through the search index."""
    n = sum(len(hs) for streets in index.values() for hs in streets.values())
    if n != len(addr):
        fail(f"{slug}: index covers {n} entries, data.json holds {len(addr)} "
             f"— a search would miss {abs(n - len(addr))} addresses")
    missing = []
    for k in list(addr)[:3000]:
        loc, street, house, flat = k.split("|")
        label = house + ("-" + flat if flat else "")
        if label not in index.get(loc, {}).get(street, []):
            missing.append(k)
            if len(missing) > 3:
                break
    if missing:
        fail(f"{slug}: addresses not findable via the index: {missing[:3]}")


def check_no_collapse(slug, addr, fail, warn):
    """The key must not have quietly lost locality or flat.

    Both failures look identical to a correct build from every other angle: the
    counts stay plausible, the types stay right, the index still agrees. Only
    the user notices, as a missed collection.
    """
    for case in NO_COLLAPSE:
        if case["area"] != slug:
            continue
        keys = [k for k in addr
                if k.split("|")[1] == case["street"]
                and k.split("|")[2] == case["house"]
                and (not case.get("locality")
                     or k.split("|")[0] == case["locality"])]
        if "min_distinct" in case:
            localities = {k.split("|")[0] for k in keys}
            if len(localities) < case["min_distinct"]:
                fail(f"{slug}: {case['street']} {case['house']} resolves to "
                     f"{len(localities)} localities, expected at least "
                     f"{case['min_distinct']} — locality has been dropped from "
                     f"the key. {case['why']}")
        if "min_flats" in case:
            flats = {k.split("|")[3] for k in keys if k.split("|")[3]}
            if len(flats) < case["min_flats"]:
                fail(f"{slug}: {case.get('locality')} {case['street']} "
                     f"{case['house']} keeps {len(flats)} flats, expected at "
                     f"least {case['min_flats']} — the flat has been dropped "
                     f"from the key. {case['why']}")


def check_known(areas, fail, warn):
    """The app's own address, end to end."""
    slug = KNOWN["area"]
    if not any(a["slug"] == slug for a in areas["areas"]):
        warn(f"{slug} not in this build — known-address check skipped")
        return
    addr = load(os.path.join(DIST, slug, "data.json"))["addresses"]
    rows = addr.get(KNOWN["key"])
    if not rows:
        near = [k for k in addr if k.startswith(KNOWN["key"].split("|")[0])][:3]
        fail(f"the app's own address {KNOWN['key']!r} is missing "
             f"(nearby keys: {near}) — normalisation has shifted")
        return
    types = {c[1] for c in rows}
    ids = {c[0] for c in rows}
    if not KNOWN["types"] <= types:
        fail(f"{KNOWN['key']}: carries {sorted(types)}, expected "
             f"{sorted(KNOWN['types'])}")
    if not KNOWN["ids"] <= ids:
        fail(f"{KNOWN['key']}: missing container(s) "
             f"{sorted(KNOWN['ids'] - ids)}")


def check_against_previous(previous, areas, fail, warn):
    """No address may lose containers versus the previous build.

    Silent loss is the failure this whole pipeline is shaped around: the app
    keeps working, the counts stay plausible, and one bin stops being collected.
    """
    for a in areas["areas"]:
        slug = a["slug"]
        old_path = os.path.join(previous, slug, "data.json")
        if not os.path.exists(old_path):
            warn(f"{slug}: no previous build to compare against")
            continue
        old = load(old_path)["addresses"]
        new = load(os.path.join(DIST, slug, "data.json"))["addresses"]

        gone = [k for k in old if k not in new]
        if gone:
            fail(f"{slug}: {len(gone)} addresses present in the previous build "
                 f"are missing now, e.g. {gone[:3]}")

        shrunk = [(k, len(old[k]), len(new[k])) for k in old
                  if k in new and len(new[k]) < len(old[k])]
        if shrunk:
            fail(f"{slug}: {len(shrunk)} addresses lost containers, e.g. "
                 f"{shrunk[:3]} — a bin would stop being collected")

        if len(new) < len(old) * 0.95:
            fail(f"{slug}: {len(new)} addresses against {len(old)} before "
                 f"({len(new)/len(old):.0%}) — an unexplained drop")


def report(problems, warnings):
    for w in warnings:
        print(f"  warn: {w}")
    for p in problems:
        print(f"  FAIL: {p}", file=sys.stderr)
    if problems:
        print(f"\n{len(problems)} problem(s) — publish must not proceed",
              file=sys.stderr)
        return 1
    print("  all checks passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
