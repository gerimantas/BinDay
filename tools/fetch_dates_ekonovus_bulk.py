#!/usr/bin/env python3
"""Fetch Ekonovus pickup dates for every locality in an area, into raw/.

    python tools/fetch_dates_ekonovus_bulk.py            # all localities in dist/
    python tools/fetch_dates_ekonovus_bulk.py --limit 5  # a sample, for a dry run

One request returns every container in a locality with its full date list, so
the unit of work is a locality (~270 for Kauno r., ~7 s each ≈ 30 min), not an
address (5 888 streets ≈ 11 h) and not a date.

Two traps, both already paid for and both silent:

  - `Datos` is a **Measure**, never a Column. `ScheduleDates.Date` is an
    unrelated calendar table; joining through it yields a cross product that
    looks entirely convincing — populated Sundays, plausible counts, wrong
    containers.
  - `InvalidUnconstrainedJoin` not firing does not mean the join is right.
    `Adresas`+`Date` does not raise it, and is exactly the query that fabricated
    results.

Writes one file per locality under raw/ekonovus/dates/, never deleting: a
locality that fails leaves its previous file in place and the build uses that.
"""

import argparse
import io
import json
import os
import re
import sys
import time
from collections import defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import fetch_dates_ekonovus as F          # noqa: E402  (query/decoding live there)
from atomic import write_json, is_fresh   # noqa: E402

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8")
    except (AttributeError, ValueError):
        pass

RAW_DATES = os.path.join("data", "raw", "ekonovus", "dates")
DIST = "dist"


def localities_from_dist(area):
    """Locality prefixes as Ekonovus writes them, taken from the labels in dist/.

    The key is normalised ("jurag"), which the operator would not match. The
    label keeps the operator's own spelling, so the locality is recovered from
    there.
    """
    path = os.path.join(DIST, area, "data.json")
    if not os.path.exists(path):
        sys.exit(f"FAILED: {path} missing — run tools/build_dist.py first")
    d = json.load(io.open(path, encoding="utf-8"))
    out = {}
    for key, label in d.get("labels", {}).items():
        stem = key.split("|", 1)[0]
        # "Žalgirio g. 8A, Juragių k." -> "Juragių k."
        parts = [p.strip() for p in label.split(",") if p.strip()]
        if len(parts) >= 2 and stem not in out:
            out[stem] = parts[-1]
    return out


def fetch_locality(template, prefix):
    """-> {address: [{inventory, type, dates}]} for one locality."""
    rows = F.query(template, address=prefix + " ")
    out = defaultdict(list)
    for row in rows:
        addr, inv, dates = (list(row) + [None, None, None])[:3]
        if not addr or not inv:
            continue
        iso = re.findall(r"20\d\d-\d\d-\d\d", str(dates or ""))
        out[str(addr).strip()].append({
            "inventory": str(inv).split("(")[0].strip(),
            "type": F.waste_type(str(inv)),
            "dates": iso,
        })
    return dict(out)


def slug(s):
    s = re.sub(r"[^\w-]+", "-", s.strip().lower())
    return re.sub(r"-+", "-", s).strip("-")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--area", default="kauno-r-sav")
    ap.add_argument("--limit", type=int, default=0,
                    help="stop after N localities (dry run)")
    ap.add_argument("--max-age-days", type=float, default=25,
                    help="skip localities fetched more recently than this")
    ap.add_argument("--template", default="tools/pbi_dates_template.json")
    args = ap.parse_args()

    localities = localities_from_dist(args.area)
    items = sorted(localities.items())
    if args.limit:
        items = items[:args.limit]
    print(f"{len(items)} localities in {args.area}")

    template = json.load(io.open(args.template, encoding="utf-8"))
    outdir = os.path.join(RAW_DATES, args.area)

    ok = skipped = 0
    failed = []
    t0 = time.time()
    for i, (stem, prefix) in enumerate(items, 1):
        path = os.path.join(outdir, slug(stem) + ".json")
        # The cheap pre-check: an unchanged month should cost seconds.
        if args.max_age_days and is_fresh(path, args.max_age_days):
            skipped += 1
            continue
        try:
            addresses = fetch_locality(template, prefix)
        except Exception as e:                      # noqa: BLE001
            failed.append((stem, prefix, str(e)[:120]))
            print(f"  {stem:<24} FAILED ({str(e)[:60]}) — previous file kept")
            continue
        write_json(path, {"locality": prefix, "stem": stem,
                          "addresses": addresses},
                   source="ekonovus/powerbi-dates",
                   request={"startsWith": prefix + " "})
        ok += 1
        if i % 20 == 0 or i == len(items):
            print(f"  {i}/{len(items)}  {time.time()-t0:.0f}s  "
                  f"ok={ok} skipped={skipped} failed={len(failed)}")

    print(f"\n{ok} fetched, {skipped} still fresh, {len(failed)} failed "
          f"in {time.time()-t0:.0f}s")
    if failed:
        for stem, prefix, err in failed[:10]:
            print(f"   {stem} ({prefix}): {err}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
