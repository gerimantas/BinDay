#!/usr/bin/env python3
"""Has anything actually changed at the operators?

    python tools/precheck.py            # exit 0 = unchanged, 10 = refresh needed

Fetches one known container per operator and compares its schedule with what
dist/ already ships. Unchanged means the scheduled run stops in seconds instead
of spending ~30 minutes re-asking for data that is identical.

Exit codes are distinct on purpose:
    0   unchanged — skip the refresh
    10  changed — run the full fetch
    1   the check itself failed — treat as "cannot tell", and refresh anyway,
        because skipping on an inconclusive check is how a stale schedule
        survives indefinitely

The witnesses are the app's own containers. They are not a statistical sample —
one address cannot prove a municipality unchanged — but they are the cheapest
signal that catches the case that matters: the operators republishing their
year. A full refresh still runs monthly regardless, so the worst case for a
false "unchanged" is one skipped cycle.
"""

import io
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8")
    except (AttributeError, ValueError):
        pass

DIST = "dist"
AREA = "kauno-r-sav"
KEY = "jurag|zalgirio g|8a|"

UNCHANGED, CHANGED, INCONCLUSIVE = 0, 10, 1


def shipped_dates():
    """-> {inventory: [dates]} for the witness address in dist/."""
    path = os.path.join(DIST, AREA, "data.json")
    if not os.path.exists(path):
        return None
    d = json.load(io.open(path, encoding="utf-8"))
    rows = d.get("addresses", {}).get(KEY)
    if not rows:
        return None
    out = {}
    for r in rows:
        if len(r) > 3 and 0 <= r[3] < len(d.get("schedules", [])):
            out[r[0]] = d["schedules"][r[3]]
    return out or None


def live_ekonovus():
    """-> {inventory: [dates]} from one Ekonovus request."""
    import re
    import fetch_dates_ekonovus as F
    template = json.load(io.open("tools/pbi_dates_template.json",
                                 encoding="utf-8"))
    rows = F.query(template, address="Juragių k. Žalgirio g. 8A")
    out = {}
    for row in rows:
        addr, inv, dates = (list(row) + [None, None, None])[:3]
        if not addr or not inv:
            continue
        out[str(inv).split("(")[0].strip()] = re.findall(
            r"20\d\d-\d\d-\d\d", str(dates or ""))
    return out


def compare(shipped, live, today):
    """Compare only the future: a shipped list is filtered to >= build day, and
    the operator's window moves forward on its own. Comparing raw lists would
    report a change every single day."""
    changes = []
    for inv, live_dates in live.items():
        if inv not in shipped:
            continue
        a = sorted(d for d in shipped[inv] if d >= today)
        b = sorted(d for d in live_dates if d >= today)
        if a != b:
            changes.append((inv, a[:3], b[:3]))
    return changes


def main():
    import time
    today = time.strftime("%Y-%m-%d")

    shipped = shipped_dates()
    if not shipped:
        print("no shipped dates to compare against — refresh needed")
        return CHANGED

    try:
        live = live_ekonovus()
    except Exception as e:                          # noqa: BLE001
        print(f"precheck could not reach Ekonovus: {e}", file=sys.stderr)
        print("treating as inconclusive — refresh anyway")
        return INCONCLUSIVE

    common = set(shipped) & set(live)
    if not common:
        print(f"witness containers not found live (shipped: {sorted(shipped)}, "
              f"live: {sorted(live)}) — refresh needed")
        return CHANGED

    changes = compare(shipped, live, today)
    if changes:
        for inv, a, b in changes:
            print(f"  {inv}: shipped {a} -> live {b}")
        print(f"{len(changes)} witness container(s) changed — refresh needed")
        return CHANGED

    print(f"{len(common)} witness container(s) unchanged since "
          f"{json.load(io.open(os.path.join(DIST, AREA, 'data.json'), encoding='utf-8')).get('collected')}"
          f" — no refresh needed")
    return UNCHANGED


if __name__ == "__main__":
    sys.exit(main())
