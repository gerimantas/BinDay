#!/usr/bin/env python3
"""Fetch pickup dates for specific Ekonovus containers.

The catalogue built by fetch_ekonovus.py holds addresses and container numbers but no
dates — adding the `Datos` measure to a bulk query makes it far too slow (a 30000-row
window did not return within two minutes). Dates are therefore fetched per address, which
is fast: one address resolves in about 7 seconds.

    python tools/fetch_dates_ekonovus.py "Juragių k. Žalgirio g. 8A"
    python tools/fetch_dates_ekonovus.py --inventory "52-P-22781 (Pakuotė)"

Output: JSON on stdout, {address, containers: [{inventory, type, dates[]}]}.
"""

import argparse
import gzip
import io
import json
import os
import re
import sys
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from pbi_decode import decode  # noqa: E402

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8")
    except (AttributeError, ValueError):
        pass

RESOURCE_KEY = "d86dc3d4-e915-4460-b12e-c925d3ae6c75"
QUERY_URL = (
    "https://wabi-west-europe-d-primary-api.analysis.windows.net"
    "/public/reports/querydata?synchronous=true"
)
TEMPLATE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "pbi_dates_template.json")


def post(body, timeout=90):
    req = urllib.request.Request(
        QUERY_URL, data=json.dumps(body, ensure_ascii=False).encode("utf-8"), method="POST")
    req.add_header("Content-Type", "application/json;charset=UTF-8")
    req.add_header("X-PowerBI-ResourceKey", RESOURCE_KEY)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        raw = resp.read()
        if raw[:2] == b"\x1f\x8b":
            raw = gzip.decompress(raw)
        return json.loads(raw.decode("utf-8"))


def query(template, *, address=None, inventory=None, max_pages=40):
    """Address + inventory + the Datos measure, filtered to one address or container.

    Paged. The window is 500 rows, and a locality query exceeds that easily —
    Akademijos mstl. alone has 246 addresses and several containers each. The
    truncation is silent: the response looks complete, and every address past
    the cutoff simply has no dates. That cost 33 420 containers (25% of the
    municipality) before it was caught, all of them looking like a normalisation
    failure rather than a missing page.
    """
    rows, token = [], None
    for _page in range(max_pages):
        got, token = _query_page(template, address, inventory, token)
        rows.extend(got)
        if not token or not got:
            break
    else:
        raise RuntimeError(
            f"stopped at the {max_pages}-page cap with more data pending for "
            f"{address or inventory!r} — the result is INCOMPLETE")
    return rows


def _query_page(template, address, inventory, restart_token):
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
    if address:
        cmd["Query"].setdefault("Where", []).append({"Condition": {"Contains": {
            "Left": {"Column": {"Expression": {"SourceRef": {"Source": "w"}},
                                "Property": "Adresas"}},
            "Right": {"Literal": {"Value": "'" + address.replace("'", "''") + "'"}}}}})
    if inventory:
        cmd["Query"].setdefault("Where", []).append({"Condition": {"In": {
            "Expressions": [{"Column": {"Expression": {"SourceRef": {"Source": "w"}},
                                        "Property": "Inventorinis nr."}}],
            "Values": [[{"Literal": {"Value": "'" + inventory.replace("'", "''") + "'"}}]]}}})
    cmd["Binding"]["Primary"] = {"Groupings": [{"Projections": [0, 1, 2]}]}
    window = {"Count": 500}
    if restart_token:
        window["RestartTokens"] = restart_token
    cmd["Binding"]["DataReduction"] = {"DataVolume": 4, "Primary": {"Window": window}}

    data = post(body)["results"][0]["result"]["data"]
    ds = data["dsr"].get("DS")
    if not ds:
        raise RuntimeError("no dataset: " + json.dumps(data["dsr"], ensure_ascii=False)[:200])
    return decode(ds[0]), ds[0].get("RT")


TYPE_BY_SUFFIX = {"Komunalinės": "MIXED", "Pakuotė": "PACKAGING", "Stiklas": "GLASS",
                  "Žaliosios": "GREEN", "Popierius": "PAPER"}
TYPE_BY_INFIX = {"L": "MIXED", "M": "MIXED", "P": "PACKAGING", "S": "GLASS"}


def waste_type(inv):
    if "(" in inv:
        s = inv.rsplit("(", 1)[1].rstrip(")").strip()
        if s in TYPE_BY_SUFFIX:
            return TYPE_BY_SUFFIX[s]
    parts = inv.split("-")
    return TYPE_BY_INFIX.get(parts[1].strip().upper(), "OTHER") if len(parts) > 1 else "OTHER"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("address", nargs="?", help="address fragment, e.g. 'Žalgirio g. 8A'")
    ap.add_argument("--inventory", help="exact inventory string incl. its (Type) suffix")
    ap.add_argument("--template", default=TEMPLATE)
    args = ap.parse_args()
    if not args.address and not args.inventory:
        ap.error("give an address or --inventory")

    template = json.load(io.open(args.template, encoding="utf-8"))
    rows = query(template, address=args.address, inventory=args.inventory)

    out = {}
    for row in rows:
        addr, inv, dates = (list(row) + [None, None, None])[:3]
        if not addr or not inv:
            continue
        iso = re.findall(r"20\d\d-\d\d-\d\d", str(dates or ""))
        out.setdefault(str(addr).strip(), []).append({
            "inventory": str(inv).split("(")[0].strip(),
            "type": waste_type(str(inv)),
            "dates": iso,
        })

    # A street name is not unique nationally — report every address that matched rather
    # than silently picking one.
    print(json.dumps([{"address": a, "containers": c} for a, c in out.items()],
                     ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
