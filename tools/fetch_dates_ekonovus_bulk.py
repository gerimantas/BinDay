#!/usr/bin/env python3
"""Fetch Ekonovus pickup dates for a whole area, into raw/.

    python tools/fetch_dates_ekonovus_bulk.py            # the area's own prefix
    python tools/fetch_dates_ekonovus_bulk.py --limit 2  # a couple of pages, dry run

One request returns 20 000 rows in ~66 s, so the unit of work is a *page of the
whole area*, not a locality. Kauno r. is 76 365 rows: four requests, ~4.5 min.

This replaces a per-locality loop that asked 266 times and took ~65 minutes. The
reason the loop was so slow is not obvious and is worth stating, because it is
what makes the bulk shape correct rather than merely faster: **a query costs
about ten seconds regardless of how much it returns.** Measured 2026-08-03 on
untouched localities — 4 rows took 12.1 s, 443 rows took 13.7 s. The expense is
the `Datos` measure being evaluated across the whole national table per request,
not the rows travelling back. So 266 small questions cost 266 x 10 s while four
large ones cost 4 x 66 s.

Three shapes were measured and rejected before this one:

  - **Batching localities** into one `Or` of `Contains` conditions: no gain at
    all (~6.3 s per locality whether batched 5, 10 or 25 at a time). The server
    does the same work, it just returns it in one response.
  - **No filter at all**, to pull the country in one pass: HTTP 500. The report
    will not evaluate `Datos` unfiltered, which is why a filter of some kind is
    required rather than merely helpful.
  - **All 13 inventory prefixes present in Kauno r.** as one `Or` chain: also
    HTTP 500 (too many conditions), and fetching them separately took 13.5 min
    to retrieve 281 098 rows nationally of which 3 308 were in Kauno r. — 1.2%
    useful, because a prefix is a *collection route*, not a municipality, and the
    same route spans the country.

That last point is the one to keep in mind before "fixing" the coverage gap
below.

## What this deliberately does not fetch

4.2% of the containers the per-locality path used to see carry a prefix other
than the area's own (66-, 55-, 73-, … in Kauno r.): 3 308 containers across
1 562 addresses, on the boundary where a neighbouring municipality's route
reaches in.

Those containers are **not in the catalogue** (`ekonovus-52.json` holds only
`52-`), and `build_dist.py` ships containers from the catalogue, so they never
reached the app under the old path either — their dates were fetched and then
discarded at merge time. Fetching them here would cost 13.5 minutes to change
nothing.

If the app is ever meant to serve them, the fix belongs in the *catalogue*
fetcher, not here — and this file should then widen to match. Until then the
gap is deliberate, and `--prefixes` exists to widen it without editing code.
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
from atomic import write_json             # noqa: E402

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8")
    except (AttributeError, ValueError):
        pass

RAW_DATES = os.path.join("data", "raw", "ekonovus", "dates")
DIST = "dist"

# The window the report will actually serve. 500 is what the report's own UI
# asks for and is NOT a server limit: 2 000 and 30 000 are both accepted, and a
# 20 000-row page costs the same ~66 s as a 2 000-row one. Raising it is most of
# the speed-up. Do not lower it back to 500 "to be safe" — that would restore
# 40 requests where 4 suffice.
PAGE = 20000

# Well past the 4 pages Kauno r. needs. A cap must exist, because the paging
# loop's exit condition is the server ceasing to return a continuation token,
# and a bug there would otherwise spin forever.
MAX_PAGES = 40


def area_prefix(area):
    """The inventory prefix an area's containers carry, from the catalogue.

    Read from the catalogue file rather than hardcoded, so an area added later
    needs no edit here. `ekonovus-52.json` -> `52`.
    """
    pattern = re.compile(r"ekonovus-(\w+)\.json$")
    found = set()
    for name in os.listdir(os.path.join("data", "raw", "ekonovus")):
        m = pattern.search(name)
        if m:
            found.add(m.group(1))
    if len(found) == 1:
        return sorted(found)[0]
    sys.exit(f"FAILED: cannot tell which prefix {area} uses; catalogues: "
             f"{sorted(found) or 'none'} — pass --prefixes explicitly")


def localities_from_dist(area):
    """Locality prefixes as Ekonovus writes them, taken from the labels in dist/.

    Only used to split the result into per-locality files, matching the layout
    build_dist.py already globs. The fetch itself no longer needs them.
    """
    path = os.path.join(DIST, area, "data.json")
    if not os.path.exists(path):
        return {}
    d = json.load(io.open(path, encoding="utf-8"))
    out = {}
    for key, label in d.get("labels", {}).items():
        stem = key.split("|", 1)[0]
        parts = [p.strip() for p in label.split(",") if p.strip()]
        if len(parts) >= 2 and stem not in out:
            out[stem] = parts[-1]
    return out


def fetch_prefix(template, prefix, limit=0):
    """-> [(address, inventory, dates)] for every container whose id starts with prefix."""
    rows, token, pages = [], None, 0
    while pages < MAX_PAGES:
        got, token = _page(template, prefix, token)
        rows.extend(got)
        pages += 1
        print(f"  page {pages}: +{len(got)} -> {len(rows)} rows", flush=True)
        if not token or not got:
            break
        if limit and pages >= limit:
            print(f"  --limit {limit} reached, stopping early", flush=True)
            return rows, False
    else:
        # Hit the cap with a token still pending: the result is short and every
        # address past the cutoff would silently have no dates. That is exactly
        # the failure that cost 33 420 containers when the 500-row window went
        # unpaged, so it must be an error, not a warning.
        raise RuntimeError(
            f"stopped at the {MAX_PAGES}-page cap with more data pending for "
            f"{prefix!r} — the result is INCOMPLETE")
    return rows, True


def _page(template, prefix, restart_token):
    body = json.loads(json.dumps(template))
    cmd = body["queries"][0]["Query"]["Commands"][0]["SemanticQueryDataShapeCommand"]
    cmd["Query"]["Select"] = [
        {"Column": {"Expression": {"SourceRef": {"Source": "w"}}, "Property": "Adresas"},
         "Name": "a"},
        {"Column": {"Expression": {"SourceRef": {"Source": "w"}},
                    "Property": "Inventorinis nr."}, "Name": "i"},
        # Datos is a Measure, not a Column — as a Column the query fails to resolve.
        {"Measure": {"Expression": {"SourceRef": {"Source": "s"}}, "Property": "Datos"},
         "Name": "d"},
    ]
    # StartsWith on the inventory number, not Contains on the address. Contains
    # would also match a prefix appearing mid-string, and the address filter is
    # what forced the per-locality loop in the first place.
    cmd["Query"].setdefault("Where", []).append({"Condition": {"StartsWith": {
        "Left": {"Column": {"Expression": {"SourceRef": {"Source": "w"}},
                            "Property": "Inventorinis nr."}},
        "Right": {"Literal": {"Value": "'" + prefix.replace("'", "''") + "-'"}}}}})
    cmd["Binding"]["Primary"] = {"Groupings": [{"Projections": [0, 1, 2]}]}
    window = {"Count": PAGE}
    if restart_token:
        window["RestartTokens"] = restart_token
    cmd["Binding"]["DataReduction"] = {"DataVolume": 4, "Primary": {"Window": window}}

    # A 20 000-row page takes ~66 s; 90 s left no margin for a slow day.
    data = F.post(body, timeout=300)["results"][0]["result"]["data"]
    ds = data["dsr"].get("DS")
    if not ds:
        raise RuntimeError("no dataset: " + json.dumps(data["dsr"], ensure_ascii=False)[:200])
    return F.decode(ds[0]), ds[0].get("RT")


def slug(s):
    s = re.sub(r"[^\w-]+", "-", s.strip().lower())
    return re.sub(r"-+", "-", s).strip("-")


def split_by_locality(rows, localities):
    """-> {stem: {address: [{inventory, type, dates}]}}

    The locality is the trailing part of the address as Ekonovus writes it
    ("Juragių k. Žalgirio g. 8A" -> "Juragių k."), matched against the labels in
    dist/. An address whose locality is not in dist/ goes to `_other`, which is
    written like any other file: build_dist.py globs the directory and merges on
    (address key, inventory), so the file a row lands in does not affect the
    result. Keeping them means a locality newly served by Ekonovus still gets
    its dates before dist/ knows the name.
    """
    by_stem = defaultdict(lambda: defaultdict(list))
    known = {v.strip().lower(): k for k, v in localities.items()}
    for addr, inv, dates in rows:
        addr = str(addr or "").strip()
        inv = str(inv or "").strip()
        if not addr or not inv:
            continue
        iso = re.findall(r"20\d\d-\d\d-\d\d", str(dates or ""))
        stem = "_other"
        for name, k in known.items():
            if addr.lower().startswith(name + " "):
                stem = k
                break
        by_stem[stem][addr].append({
            "inventory": inv.split("(")[0].strip(),
            "type": F.waste_type(inv),
            "dates": iso,
        })
    return by_stem


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--area", default="kauno-r-sav")
    ap.add_argument("--prefixes", default="",
                    help="comma-separated inventory prefixes; default: the "
                         "area's own, read from the catalogue")
    ap.add_argument("--limit", type=int, default=0,
                    help="stop after N pages per prefix (dry run)")
    ap.add_argument("--template", default="tools/pbi_dates_template.json")
    args = ap.parse_args()

    prefixes = ([p.strip() for p in args.prefixes.split(",") if p.strip()]
                or [area_prefix(args.area)])
    template = json.load(io.open(args.template, encoding="utf-8"))

    t0 = time.time()
    rows, complete = [], True
    for prefix in prefixes:
        print(f"{prefix}- ...", flush=True)
        got, ok = fetch_prefix(template, prefix, args.limit)
        rows.extend(got)
        complete = complete and ok
    print(f"{len(rows)} rows in {time.time()-t0:.0f}s", flush=True)

    localities = localities_from_dist(args.area)
    by_stem = split_by_locality(rows, localities)
    if not by_stem:
        sys.exit("FAILED: no rows decoded — refusing to overwrite raw/ with nothing")

    # A dry run has deliberately partial data. Writing it would leave raw/
    # looking like a complete fetch, and the next build would ship it.
    #
    # Keyed on --limit being set at all, NOT on whether the cap was reached.
    # A prefix small enough to fit in one page finishes "completely" under
    # --limit 1, and an earlier version wrote those files — a dry run that
    # silently mutates raw/ is worse than no dry run, because the operator
    # believes nothing happened.
    if args.limit or not complete:
        print(f"\ndry run (--limit {args.limit}) — nothing written", flush=True)
        return

    outdir = os.path.join(RAW_DATES, args.area)
    written = 0
    for stem, addresses in sorted(by_stem.items()):
        write_json(os.path.join(outdir, slug(stem) + ".json"),
                   {"locality": localities.get(stem, stem), "stem": stem,
                    "addresses": dict(addresses)},
                   source="ekonovus/powerbi-dates",
                   request={"prefixes": prefixes})
        written += 1

    dated = sum(1 for a in by_stem.values() for c in a.values()
                for x in c if x["dates"])
    total = sum(len(c) for a in by_stem.values() for c in a.values())
    print(f"\n{written} locality files, {total} containers, {dated} with dates "
          f"({100*dated/total:.1f}%) in {time.time()-t0:.0f}s")


if __name__ == "__main__":
    main()
