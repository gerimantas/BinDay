#!/usr/bin/env python3
"""Refresh only the three schedules for Žalgirio g. 8A, Juragiai.

This deliberately does not enumerate areas, addresses, or containers.  It asks the
operators for the three already resolved inventory numbers, updates the built-in app
schedule, and gives this address private schedule rows in dist/ so no neighbour is
changed by accident.
"""

from __future__ import annotations

import datetime as dt
import hashlib
import io
import json
import os
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_JS = os.path.join(ROOT, "src", "js", "data.js")
DIST_JSON = os.path.join(ROOT, "dist", "kauno-r-sav", "data.json")
VERSION_JSON = os.path.join(ROOT, "dist", "version.json")
ADDRESS_KEY = "jurag|zalgirio g|8a|"
INVENTORIES = ("52-MK-036668", "52-P-22781", "52-S-24716")

sys.path.insert(0, os.path.join(ROOT, "tools"))


def live_dates() -> dict[str, list[str]]:
    import precheck

    result = precheck.live_ekonovus()
    proc = subprocess.run(
        ["node", os.path.join(ROOT, ".github", "workflows", "probe_svara.mjs"), "--json"],
        cwd=ROOT, text=True, encoding="utf-8", capture_output=True, check=True,
    )
    marker = next((line for line in proc.stdout.splitlines()
                   if line.startswith("SCHEDULE_JSON=")), None)
    if not marker:
        raise RuntimeError("Švara probe returned no machine-readable schedule")
    svara = json.loads(marker.removeprefix("SCHEDULE_JSON="))
    result[svara["inventory"]] = svara["dates"]

    missing = set(INVENTORIES) - set(result)
    if missing:
        raise RuntimeError(f"operator response omitted: {sorted(missing)}")
    return {key: sorted(set(result[key])) for key in INVENTORIES}


def merge_history(old: list[str], live: list[str], today: str) -> list[str]:
    """The live Ekonovus window contains future dates only; retain elapsed history."""
    return sorted(set(d for d in old if d < today) | set(d for d in live if d >= today))


def replace_js_schedule(text: str, inventory: str, dates: list[str]) -> str:
    start = text.index(f"id: '{inventory}'")
    end = text.index("\n  }", start)
    block = text[start:end]
    block = re.sub(r"until: '\d{4}-\d{2}-\d{2}'", f"until: '{max(dates)}'", block)
    formatted = []
    for offset in range(0, len(dates), 5):
        formatted.append("            " + ",".join(repr(d) for d in dates[offset:offset + 5]))
    dates_literal = "[" + (",\n".join(line.lstrip() if i == 0 else line
                                      for i, line in enumerate(formatted))) + "]"
    block, count = re.subn(r"dates: \[.*?\]", "dates: " + dates_literal, block,
                           count=1, flags=re.DOTALL)
    if count != 1:
        raise RuntimeError(f"could not replace dates for {inventory}")
    return text[:start] + block + text[end:]


def update_dist(schedules: dict[str, list[str]], today: str) -> None:
    with io.open(DIST_JSON, encoding="utf-8") as fh:
        data = json.load(fh)
    rows = data.get("addresses", {}).get(ADDRESS_KEY)
    if not rows:
        raise RuntimeError("Žalgirio 8A is missing from dist data")

    changed = False
    for row in rows:
        inventory = row[0]
        if inventory not in schedules:
            continue
        old = data["schedules"][row[3]] if len(row) > 3 else []
        merged = merge_history(old, schedules[inventory], today)
        if old == merged:
            continue
        data["schedules"].append(merged)
        changed = True
        if len(row) > 3:
            row[3] = len(data["schedules"]) - 1
        else:
            row.append(len(data["schedules"]) - 1)
    if not changed:
        return
    with io.open(DIST_JSON, "w", encoding="utf-8", newline="\n") as fh:
        json.dump(data, fh, ensure_ascii=False, separators=(",", ":"))
        fh.write("\n")
    with io.open(DIST_JSON, encoding="utf-8") as fh:
        signature = hashlib.sha256(fh.read().encode("utf-8")).hexdigest()[:16]
    with io.open(VERSION_JSON, encoding="utf-8") as fh:
        version = json.load(fh)
    version["built"] = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    version.setdefault("areas", {})["kauno-r-sav"] = signature
    with io.open(VERSION_JSON, "w", encoding="utf-8", newline="\n") as fh:
        json.dump(version, fh, ensure_ascii=False, indent=1)
        fh.write("\n")


def main() -> int:
    today = dt.date.today().isoformat()
    live = live_dates()

    with io.open(DATA_JS, encoding="utf-8") as fh:
        text = fh.read()
    old_by_inventory = {
        inventory: re.findall(r"20\d\d-\d\d-\d\d", text[text.index(f"id: '{inventory}'"):
                                                         text.index("\n  }", text.index(f"id: '{inventory}'"))])
        for inventory in INVENTORIES
    }
    merged = {inventory: merge_history(old_by_inventory[inventory], live[inventory], today)
              for inventory in INVENTORIES}
    changed = any(merged[inventory] != sorted(set(old_by_inventory[inventory]))
                  for inventory in INVENTORIES)
    text, checked_count = re.subn(r"const DEFAULT_CHECKED = '\d{4}-\d{2}-\d{2}';",
                                  f"const DEFAULT_CHECKED = '{today}';", text)
    if checked_count != 1:
        raise RuntimeError("could not update the last successful check date")
    if changed:
        text = re.sub(r"const DEFAULT_COLLECTED = '\d{4}-\d{2}-\d{2}';",
                      f"const DEFAULT_COLLECTED = '{today}';", text)
    for inventory in INVENTORIES:
        text = replace_js_schedule(text, inventory, merged[inventory])
    with io.open(DATA_JS, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(text)

    update_dist(live, today)
    for inventory in INVENTORIES:
        print(f"{inventory}: {len(merged[inventory])} dates, through {max(merged[inventory])}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
