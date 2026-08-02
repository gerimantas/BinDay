#!/usr/bin/env python3
"""Does Ekonovus' Power BI answer from a GitHub runner?

Asks for one locality with dates — the query shape the pipeline would actually use — and
checks the answer against the two containers already in the app. Exits non-zero on any
failure so the workflow step goes red rather than passing on an empty result.
"""

import gzip
import json
import sys
import time
import urllib.error
import urllib.request

RESOURCE_KEY = "d86dc3d4-e915-4460-b12e-c925d3ae6c75"
URL = ("https://wabi-west-europe-d-primary-api.analysis.windows.net"
       "/public/reports/querydata?synchronous=true")
TEMPLATE = "tools/pbi_dates_template.json"
LOCALITY = "Juragių k. "
EXPECT = {"52-P-22781": "2026-08-04", "52-S-24716": "2027-07-06"}

sys.path.insert(0, "tools")
from pbi_decode import decode  # noqa: E402

for stream in (sys.stdout, sys.stderr):
    try:
        stream.reconfigure(encoding="utf-8")
    except (AttributeError, ValueError):
        pass


def post(body, timeout=180):
    req = urllib.request.Request(
        URL, data=json.dumps(body, ensure_ascii=False).encode("utf-8"), method="POST")
    req.add_header("Content-Type", "application/json;charset=UTF-8")
    req.add_header("X-PowerBI-ResourceKey", RESOURCE_KEY)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        raw = resp.read()
        if raw[:2] == b"\x1f\x8b":
            raw = gzip.decompress(raw)
        return json.loads(raw.decode("utf-8"))


def column(source, prop, name):
    return {"Column": {"Expression": {"SourceRef": {"Source": source}}, "Property": prop},
            "Name": name}


template = json.load(open(TEMPLATE, encoding="utf-8"))
body = json.loads(json.dumps(template))
cmd = body["queries"][0]["Query"]["Commands"][0]["SemanticQueryDataShapeCommand"]
cmd["Query"]["Select"] = [
    column("w", "Adresas", "a"),
    column("w", "Inventorinis nr.", "i"),
    # Datos is a Measure, never a Column — it is what carries the container↔date relationship
    {"Measure": {"Expression": {"SourceRef": {"Source": "s"}}, "Property": "Datos"},
     "Name": "m"},
]
cmd["Query"]["Where"] = cmd["Query"]["Where"] + [
    {"Condition": {"StartsWith": {
        "Left": {"Column": {"Expression": {"SourceRef": {"Source": "w"}},
                            "Property": "Adresas"}},
        "Right": {"Literal": {"Value": f"'{LOCALITY}'"}}}}},
]
cmd["Binding"] = {
    "Primary": {"Groupings": [{"Projections": [0, 1, 2]}]},
    "DataReduction": {"DataVolume": 3, "Primary": {"Window": {"Count": 30000}}},
    "Version": 1,
}

started = time.time()
try:
    result = post(body)
except urllib.error.HTTPError as err:
    print(f"FAIL: HTTP {err.code} — {err.read()[:300]!r}")
    sys.exit(1)
except Exception as err:  # noqa: BLE001 — any transport failure is the answer we want
    print(f"FAIL: {type(err).__name__}: {err}")
    sys.exit(1)

elapsed = time.time() - started
data = result["results"][0]["result"]["data"]
shapes = data["dsr"].get("DataShapes")
if shapes and "odata.error" in shapes[0]:
    print("FAIL: " + shapes[0]["odata.error"]["message"]["value"][:200])
    sys.exit(1)

rows = decode(data["dsr"]["DS"][0])
print(f"OK: {len(rows)} rows in {elapsed:.1f}s")

found = {}
for address, inventory, dates in rows:
    for number in EXPECT:
        if inventory and number in str(inventory):
            found[number] = (address, str(dates))

failures = []
for number, expected_date in EXPECT.items():
    if number not in found:
        failures.append(f"{number}: not returned")
        continue
    address, dates = found[number]
    mark = "OK " if expected_date in dates else "BAD"
    print(f"  {mark} {number} @ {address}: {dates[:70]}")
    if expected_date not in dates:
        failures.append(f"{number}: expected {expected_date}, absent")

if failures:
    print("FAIL: " + "; ".join(failures))
    sys.exit(1)
print("Ekonovus reachable from this runner, dates match the shipped app.")
