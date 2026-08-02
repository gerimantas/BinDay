#!/usr/bin/env python3
"""Attach fetched dates to dist/ as a shared schedule table.

Imported by tools/build_dist.py; not run on its own.

Schedules are heavily shared: 16 093 containers measured across 51 localities
collapsed to 119 distinct date sets. So a date list is stored once in
`schedules`, and every container holds an index into it. Storing dates per
container instead would repeat the same 12 strings tens of thousands of times.

A locality is NOT one schedule — 106 (locality, waste-type) pairs carry more
than one, and Domeikava and Ringaudai have 8 distinct glass schedules each — so
the index is per container, never derived from the locality.

Matching:
  Ekonovus  by (address string, inventory number), from one file per locality
  Švara     by wasteObjectId, from one file per area
"""

import glob
import io
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from normalise import parse_ekonovus  # noqa: E402

RAW = "data/raw"


def load_ekonovus_dates(area):
    """-> {(key, inventory): [dates]} keyed on the normalised address key."""
    out = {}
    pattern = os.path.join(RAW, "ekonovus", "dates", area, "*.json")
    files = [p for p in sorted(glob.glob(pattern))
             if not p.endswith(".meta.json")]
    for path in files:
        d = json.load(io.open(path, encoding="utf-8"))
        for address, containers in d.get("addresses", {}).items():
            key = parse_ekonovus(address)
            if not key:
                continue
            for c in containers:
                if c.get("dates"):
                    out[(key, c["inventory"])] = c["dates"]
    return out, len(files)


def load_svara_dates(area):
    """-> {wasteObjectId: [dates]}"""
    path = os.path.join(RAW, "svara", area, "dates.json")
    if not os.path.exists(path):
        return {}, 0
    d = json.load(io.open(path, encoding="utf-8"))
    dates = {str(k): v for k, v in d.get("dates", {}).items() if v}
    return dates, 1


def load_svara_objects(area):
    """-> {(key, inventory): wasteObjectId} from the catalogue."""
    from normalise import parse_svara
    path = os.path.join(RAW, "svara", area, "contracts.json")
    if not os.path.exists(path):
        return {}
    d = json.load(io.open(path, encoding="utf-8"))
    out = {}
    for e in d.get("entries", []):
        if len(e) < 5 or not e[4]:
            continue
        key = parse_svara(e[0])
        if key:
            out[(key, str(e[1]).strip())] = str(e[4])
    return out


class Schedules:
    """Deduplicating store: a date list is written once, referenced by index.

    Past dates are dropped before deduplicating. Švara returns a rolling window
    that reaches backwards — a container fetched today carries collections from
    June — while Ekonovus returns only future ones. Keeping them would be worse
    than useless: the app never shows a past pickup, and two containers on the
    identical forward schedule would land in different buckets purely because
    their histories differ. Measured: 5 989 "distinct" schedules with history,
    against 400 without.
    """

    def __init__(self, since):
        self.since = since
        self._index = {}
        self.list = []

    def add(self, dates):
        future = [d for d in dates if d >= self.since]
        if not future:
            return None
        k = tuple(future)
        if k not in self._index:
            self._index[k] = len(self.list)
            self.list.append(list(future))
        return self._index[k]


def attach(by_key, area, verbose=True, since=None):
    """Add a schedule index to every container row that has dates.

    Rows are [id, type, operatorIndex] and become
    [id, type, operatorIndex, scheduleIndex] when dates are known. A row without
    dates keeps its 3-element shape, so the app can tell "no dates yet" from
    "no pickups", which are very different answers.
    """
    ek, ek_files = load_ekonovus_dates(area)
    sv_dates, sv_files = load_svara_dates(area)
    sv_objects = load_svara_objects(area)

    # Today, so a build is reproducible within a day and the horizon does not
    # drift mid-run.
    since = since or time.strftime("%Y-%m-%d")
    schedules = Schedules(since)
    matched = unmatched = expired = 0

    for key, rows in by_key.items():
        for row in rows:
            inv = row[0]
            dates = ek.get((key, inv))
            if dates is None:
                obj = sv_objects.get((key, inv))
                if obj:
                    dates = sv_dates.get(obj)
            if dates:
                idx = schedules.add(dates)
                if idx is None:
                    # Every published date is in the past: the operator's
                    # horizon has run out for this container. Left without an
                    # index so the app says "refresh needed" rather than
                    # inventing dates.
                    expired += 1
                    unmatched += 1
                else:
                    row.append(idx)
                    matched += 1
            else:
                unmatched += 1

    if verbose:
        total = matched + unmatched
        print(f"  dates: {matched}/{total} containers matched "
              f"({matched*100.0/max(1,total):.1f}%), "
              f"{len(schedules.list)} distinct schedules")
        print(f"         sources: {ek_files} Ekonovus locality files, "
              f"{sv_files} Švara file; {expired} containers past their horizon")
    return schedules.list, {"matched": matched, "unmatched": unmatched,
                            "schedules": len(schedules.list)}
