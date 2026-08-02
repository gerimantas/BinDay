#!/usr/bin/env python3
"""Merge raw/ into dist/ — the files the app actually fetches.

    python tools/build_dist.py                 # build dist/ from data/raw/
    python tools/build_dist.py --area kauno-r-sav

Pure function of raw/: no network, and it owns dist/ entirely. Deleting dist/ is
safe — one run restores it in seconds. That asymmetry is why only the fetchers
may write raw/ (see tools/atomic.py).

Builds into dist.tmp/ and renames at the end, so dist/ is never half-written.

Output:

    dist/
      version.json          {built, areas: {"kauno-r-sav": "<sha>"}}
      areas.json            derived from what is on disk, never written ahead of it
      kauno-r-sav/
        index.json          locality -> streets -> house numbers   (the search index)
        data.json           address key -> containers              (what a pick resolves to)

Schedules are not written yet: raw/ holds containers, not dates. `data.json`
carries container ids so step 8 can attach date lists without changing this
shape.
"""

import io
import json
import os
import shutil
import sys
import time
from collections import defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from atomic import write_json, read_meta  # noqa: E402
from normalise import PARSERS, key_str    # noqa: E402

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8")
    except (AttributeError, ValueError):
        pass

RAW = "data/raw"
DIST = "dist"
TMP = "dist.tmp"

# Which raw files feed which published area. Explicit rather than globbed: a
# stray file in raw/ must not silently become a published municipality.
AREAS = {
    "kauno-r-sav": {
        "municipality": "Kauno r. sav.",
        "sources": [
            ("svara", "Švara", os.path.join(RAW, "svara", "kauno-r-sav",
                                            "contracts.json")),
            ("ekonovus", "Ekonovus", os.path.join(RAW, "ekonovus",
                                                  "ekonovus-52.json")),
        ],
    },
}


def load_source(parser_name, operator, path):
    """-> (rows, stats). rows: [(key, container_id, waste_type, operator)]"""
    if not os.path.exists(path):
        return [], {"missing": True}
    parse = PARSERS[parser_name]
    d = json.load(io.open(path, encoding="utf-8"))
    rows, unparsed = [], 0
    for e in d.get("entries", []):
        key = parse(e[0])
        if not key:
            unparsed += 1
            continue
        rows.append((key, str(e[1]).strip(), e[2], operator))
    return rows, {
        "file": path,
        "declared": d.get("count"),
        "parsed": len(rows),
        "unparsed": unparsed,
        "fetched_at": (read_meta(path) or {}).get("fetched_at"),
    }


def build_area(slug, spec):
    rows, stats = [], []
    for parser_name, operator, path in spec["sources"]:
        r, s = load_source(parser_name, operator, path)
        if s.get("missing"):
            sys.exit(f"FAILED: {slug}: missing source {path}\n"
                     f"  run the fetchers first (tools/fetch_*)")
        rows += r
        stats.append(s)
        pct = s["unparsed"] * 100.0 / max(1, s["parsed"] + s["unparsed"])
        print(f"  {operator:<10} {s['parsed']:>7} parsed, "
              f"{s['unparsed']:>5} unparsed ({pct:.1f}%)  {s['fetched_at']}")

    # One entry per address, carrying every container found at it.
    #
    # Rows are tuples, not objects: this file is downloaded and parsed on a
    # phone, and repeating the keys "id"/"type"/"operator" 133 000 times costs
    # more than the data. [id, type, operatorIndex] against the area's
    # `operators` list. 8.7 MB of objects becomes 4.4 MB of tuples.
    ops = [op for _p, op, _f in spec["sources"]]
    op_index = {op: i for i, op in enumerate(ops)}
    by_key = defaultdict(list)
    for key, cid, wtype, operator in rows:
        by_key[key].append([cid, wtype, op_index[operator]])

    # Search index: locality -> street -> [house numbers]. Flats are kept as
    # distinct entries because they can carry different schedules, so the index
    # lists "12-1" alongside "12" rather than collapsing them.
    index = defaultdict(lambda: defaultdict(set))
    for loc, street, house, flat in by_key:
        index[loc][street].add(house + ("-" + flat if flat else ""))

    # `operators` makes the integer in each row readable without consulting
    # another file — a data file that cannot be understood on its own is how an
    # index that lies gets believed. Sorted on the string form because the raw
    # key holds None for "no flat", and None is not comparable with str.
    data = {
        "operators": ops,
        "addresses": {key_str(k): by_key[k] for k in sorted(by_key, key=key_str)},
    }
    index_out = {loc: {st: sorted(hs) for st, hs in sorted(streets.items())}
                 for loc, streets in sorted(index.items())}

    both = sum(1 for v in by_key.values() if len({c[2] for c in v}) == 2)
    with_flat = sum(1 for k in by_key if k[3])
    print(f"  -> {len(by_key)} addresses "
          f"({both} at both operators, {with_flat} carrying a flat)")
    print(f"     {len(index_out)} localities, "
          f"{sum(len(s) for s in index_out.values())} streets")

    return index_out, data, stats


def main():
    only = None
    if "--area" in sys.argv:
        only = sys.argv[sys.argv.index("--area") + 1]

    # Read the previous version.json before dist/ is touched — it is the only
    # way to tell "rebuilt identical" from "rebuilt with changes".
    prev_version = {}
    if os.path.exists(os.path.join(DIST, "version.json")):
        try:
            prev_version = json.load(
                io.open(os.path.join(DIST, "version.json"), encoding="utf-8"))
        except (ValueError, OSError):
            pass

    if os.path.exists(TMP):
        shutil.rmtree(TMP)
    os.makedirs(TMP)

    areas_meta = []
    signatures = {}
    for slug, spec in AREAS.items():
        if only and slug != only:
            continue
        print(f"{slug} ({spec['municipality']}):")
        index_out, data, stats = build_area(slug, spec)

        # compact: these two are what the phone downloads and parses.
        adir = os.path.join(TMP, slug)
        write_json(os.path.join(adir, "index.json"), index_out,
                   source="build_dist", compact=True)
        meta = write_json(os.path.join(adir, "data.json"), data,
                          source="build_dist", compact=True)
        signatures[slug] = meta["sha256"][:16]
        areas_meta.append({
            "slug": slug,
            "municipality": spec["municipality"],
            "addresses": len(data["addresses"]),
            "operators": [op for _p, op, _f in spec["sources"]],
            "files": ["index.json", "data.json"],
        })

    # areas.json is derived from what was just written, never declared ahead of
    # it. data/catalog/index.json declared 22 areas of which 3 existed; an index
    # that lies is worse than none, because every later step trusts it.
    for a in areas_meta:
        for f in a["files"]:
            p = os.path.join(TMP, a["slug"], f)
            if not os.path.exists(p):
                sys.exit(f"FAILED: areas.json would name a missing file: {p}")

    write_json(os.path.join(TMP, "areas.json"),
               {"generated": time.strftime("%Y-%m-%d"), "areas": areas_meta},
               source="build_dist")

    # Carry the previous `built` timestamp forward when every area signature is
    # unchanged. Otherwise a rebuild that produced identical data still changes
    # version.json, which means a git diff on every run and — once step 9 lands
    # — clients re-downloading an area whose contents did not move.
    built = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    if prev_version.get("areas") == signatures and prev_version.get("built"):
        built = prev_version["built"]
    write_json(os.path.join(TMP, "version.json"),
               {"built": built, "areas": signatures}, source="build_dist")

    # dist/ is a published artefact, not fetch output: its provenance is the
    # commit that contains it. Sidecars belong to raw/, where they record what
    # an operator returned and when. Keeping them here would mean a timestamp
    # changing on every rebuild, so every run would show a git diff even when
    # the data is identical — and a diff that is always there is never read.
    for dirpath, _dirs, fs in os.walk(TMP):
        for f in fs:
            if f.endswith(".meta.json"):
                os.remove(os.path.join(dirpath, f))

    # Rename last: dist/ is either the previous build or the new one, never half
    # of either.
    if os.path.exists(DIST):
        shutil.rmtree(DIST)
    os.rename(TMP, DIST)

    size = sum(os.path.getsize(os.path.join(dp, f))
               for dp, _d, fs in os.walk(DIST) for f in fs)
    print(f"\ndist/ written, {size/1e6:.2f} MB across "
          f"{sum(len(fs) for _dp, _d, fs in os.walk(DIST))} files")


if __name__ == "__main__":
    main()
