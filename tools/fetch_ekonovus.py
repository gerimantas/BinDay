#!/usr/bin/env python3
"""Build the Ekonovus address catalogue, one JSON file per municipality.

The report's Power BI backend answers anonymously — the resource key below is published
in the embed URL on ekonovus.lt and is the only credential. See the `binday` skill for
the traps this file already works around (gzip, delta-encoded rows, singular type
suffixes, windowed paging).

    python tools/fetch_ekonovus.py            # writes data/raw/ekonovus/

Writes data/raw/ekonovus/ekonovus-<code>.json for every municipality code seen, plus an
index.json summarising them. Roughly 410 000 containers across 22 municipalities in
about 3-4 minutes.

Writes whole files and never deletes: a municipality that fails leaves its previous file
intact and the build uses that. Every write is atomic (temp file, fsync, rename), so an
interrupted run cannot leave half a file behind. Each file gets a .meta.json sidecar
recording when it was fetched, from what, and its sha256.
"""

import argparse
import gzip
import io
import json
import os
import sys
import time
import urllib.request
from collections import defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from atomic import write_json, RAW  # noqa: E402

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

# Container numbers start with a municipality code — but it is Ekonovus's OWN numbering,
# not the official Lithuanian one, and the two disagree badly. Mapping them by the
# official list mislabelled 50 321 Vilnius addresses as "Druskininkų sav." and got Šakiai,
# Rietavas, Skuodas and Panevėžys wrong as well.
#
# So only codes whose name has been checked against the addresses inside the file are
# listed here. Anything else is named from its own data by `name_from_addresses()`, which
# cannot be wrong in the same way. `check_names()` re-verifies these on every run.
# Each entry: code -> (name, a locality that must appear inside the file). The witness is
# what makes the check meaningful — Kauno r.'s own name appears in none of its addresses
# (they are Garliavos, Domeikavos, Ringaudų…), so checking for "Kauno" would cry wolf,
# while checking for a known village catches a genuine swap.
MUNICIPALITIES = {
    "13": ("Vilniaus m. sav.", "Vilniaus"),
    "49": ("Kaišiadorių r. sav.", "Kaišiadorių"),
    "52": ("Kauno r. sav.", "Garliavos"),
}


def check_names(by_code):
    """Re-verify the hand-checked names; a silent mislabel misroutes users."""
    bad = []
    for code, (name, witness) in MUNICIPALITIES.items():
        entries = by_code.get(code)
        if not entries:
            continue
        stem = witness[:5].lower()
        seen = any(a.strip().lstrip(".").split(" ")[0][:5].lower() == stem
                   for a, _b, _t in entries)
        if not seen:
            bad.append(f"code {code}: declared {name!r} but no address mentions "
                       f"{witness!r} — the code mapping has probably shifted")
    for line in bad:
        print("WARNING: " + line, file=sys.stderr)
    return not bad

# Waste type, from the suffix when present and the number's infix otherwise — not every
# row carries a suffix (observed bare `13-P-409281`).
TYPE_BY_SUFFIX = {
    "Komunalinės": "MIXED",
    "Pakuotė": "PACKAGING",
    "Stiklas": "GLASS",
    "Žaliosios": "GREEN",
    "Popierius": "PAPER",
}
# Infixes seen in real data. Two-letter forms occur alongside one-letter ones —
# Kaišiadorys uses MK/KA/SA where Kaunas uses MK/P/S — and a one-letter-only table left
# every Kaišiadorys container as OTHER, i.e. a grey dot instead of the bin's colour.
#
# KA and SA were checked against their actual schedules rather than guessed: 49-SA-02069
# collects 4x a year at ~91-day intervals (glass, matching the known 84-day glass
# container), and 49-KA-06041 12x a year at 28-35 days, which rules out mixed waste
# (fortnightly) and matches the packaging cadence.
TYPE_BY_INFIX = {
    "L": "MIXED", "M": "MIXED", "MK": "MIXED", "MA": "MIXED", "RA": "MIXED",
    "P": "PACKAGING", "PA": "PACKAGING", "PK": "PACKAGING", "KA": "PACKAGING",
    "S": "GLASS", "SA": "GLASS", "ST": "GLASS",
    "Z": "GREEN", "ZA": "GREEN", "ZL": "GREEN",
    # The -V- forms are the shared bins at blocks of flats: one address carries only
    # PLV/PV/SV and no private bin, and they are emptied weekly rather than fortnightly
    # (52-SV-00332 every 28 days). Plastikas/popierius/stiklas respectively.
    "PLV": "PACKAGING", "PV": "PAPER", "SV": "GLASS",
}
# 49-RA-00193 collects every 14 days — the mixed-waste cadence.


def post(body, timeout=120):
    req = urllib.request.Request(
        QUERY_URL,
        data=json.dumps(body, ensure_ascii=False).encode("utf-8"),
        method="POST",
    )
    req.add_header("Content-Type", "application/json;charset=UTF-8")
    req.add_header("X-PowerBI-ResourceKey", RESOURCE_KEY)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        raw = resp.read()
        if raw[:2] == b"\x1f\x8b":          # always gzipped in practice
            raw = gzip.decompress(raw)
        return json.loads(raw.decode("utf-8"))


def build_query(template, restart_token=None, count=10000):
    """Address + inventory number only.

    Deliberately without the `Datos` measure: adding it makes bulk paging far slower (a
    30000-row window did not return within two minutes), so dates are fetched per
    container separately.
    """
    body = json.loads(json.dumps(template))
    cmd = body["queries"][0]["Query"]["Commands"][0]["SemanticQueryDataShapeCommand"]
    cmd["Query"]["Select"] = [
        {"Column": {"Expression": {"SourceRef": {"Source": "w"}}, "Property": "Adresas"},
         "Name": "a"},
        {"Column": {"Expression": {"SourceRef": {"Source": "w"}},
                    "Property": "Inventorinis nr."}, "Name": "i"},
    ]
    cmd["Binding"]["Primary"] = {"Groupings": [{"Projections": [0, 1]}]}
    window = {"Count": count}
    if restart_token:
        window["RestartTokens"] = restart_token
    cmd["Binding"]["DataReduction"] = {"DataVolume": 4, "Primary": {"Window": window}}
    return body


def waste_type(inventory):
    if "(" in inventory:
        suffix = inventory.rsplit("(", 1)[1].rstrip(")").strip()
        if suffix in TYPE_BY_SUFFIX:
            return TYPE_BY_SUFFIX[suffix]
    # Scan every segment rather than assuming position [1]: not all numbers carry the
    # municipality prefix (Kauno m. writes "MA-000017", Kauno r. "52-MK-036668"), so a
    # fixed index lands on a serial number and classifies the lot as OTHER.
    for part in inventory.split("-"):
        found = TYPE_BY_INFIX.get(part.strip().upper())
        if found:
            return found
    return "OTHER"


def fetch_all(template, max_pages=80, verbose=True):
    rows, token, t0 = [], None, time.time()
    for page in range(max_pages):
        data = post(build_query(template, token))
        ds = data["results"][0]["result"]["data"]["dsr"]["DS"][0]
        got = decode(ds)
        rows.extend(got)
        token = ds.get("RT")
        if verbose:
            print(f"  page {page}: +{len(got):>5} total={len(rows):>7} "
                  f"t={time.time() - t0:.0f}s", flush=True)
        if not token or not got:
            break
    else:
        print(f"  WARNING: stopped at the {max_pages}-page cap with more data pending. "
              f"The catalogue is INCOMPLETE.", file=sys.stderr)
    return rows


def name_from_addresses(entries):
    """Name a file from the addresses inside it, rather than from its container code.

    Ekonovus numbers containers with its own municipality codes, and they do not match
    the official Lithuanian ones — a hand-written table guessing at them mislabelled
    50 321 Vilnius addresses as "Druskininkų sav.", and got Šakiai, Rietavas and Skuodas
    wrong too. Guessing is the bug; the addresses are the evidence, so derive the label
    from them.

    Localities are genitive ("Garliavos", "Dembavos"), so the label is "<commonest
    locality> ir apylinkės" unless one locality clearly dominates the file.
    """
    counts = {}
    for address, _bare, _t in entries:
        w = address.strip().lstrip(".").split(" ")[0]
        if w:
            counts[w] = counts.get(w, 0) + 1
    if not counts:
        return None
    common, n = max(counts.items(), key=lambda kv: kv[1])
    share = n / len(entries)
    distinct = len(counts)
    if distinct == 1 or share > 0.8:
        return common
    return f"{common} ir apylinkės"


def main():
    ap = argparse.ArgumentParser()
    # Fetch output goes to raw/, which this script writes and never deletes.
    # Anything derived from it belongs in dist/, owned by the build step.
    ap.add_argument("--out", default=os.path.join(RAW, "ekonovus"))
    ap.add_argument("--template", default="tools/pbi_template.json",
                    help="a captured querydata request body (see the binday skill)")
    args = ap.parse_args()

    template = json.load(io.open(args.template, encoding="utf-8"))
    print("fetching Ekonovus catalogue...")
    rows = fetch_all(template)
    print(f"decoded {len(rows)} rows")

    by_code = defaultdict(list)
    skipped = 0
    for address, inventory in rows:
        address, inventory = str(address).strip(), str(inventory).strip()
        if not address or not inventory:
            skipped += 1
            continue
        code = inventory[:2]
        if not code.isdigit():
            skipped += 1
            continue
        bare = inventory.split("(")[0].strip()
        by_code[code].append([address, bare, waste_type(inventory)])

    if skipped:
        print(f"skipped {skipped} unusable rows")

    # An unmapped infix silently becomes OTHER, which the app paints grey — the bin loses
    # its colour and the user cannot tell which one goes out. Operators differ (Kaunas
    # uses MK/P/S, Kaišiadorys KA/SA/RA), so surface anything new instead of hiding it.
    unknown = {}
    for entries in by_code.values():
        for _addr, inv, wtype in entries:
            if wtype == "OTHER":
                parts = inv.split("-")
                if len(parts) > 1:
                    unknown[parts[1]] = unknown.get(parts[1], 0) + 1
    if unknown:
        top = sorted(unknown.items(), key=lambda kv: -kv[1])[:8]
        print("WARNING: unmapped container infixes -> OTHER (grey dot in the app):",
              file=sys.stderr)
        for infix, n in top:
            print(f"    {infix}: {n} containers", file=sys.stderr)
        print("    Check one container's collection interval, then add it to "
              "TYPE_BY_INFIX.", file=sys.stderr)

    check_names(by_code)

    os.makedirs(args.out, exist_ok=True)
    index = []
    failed = []
    for code, entries in sorted(by_code.items(), key=lambda kv: -len(kv[1])):
        known = MUNICIPALITIES.get(code)
        name = (known[0] if known else None) or name_from_addresses(entries) \
            or f"(kodas {code})"
        # One municipality failing must not abandon the rest, and must never remove
        # the previous file: a missing new file is not a deleted old one.
        try:
            path = os.path.join(args.out, f"ekonovus-{code}.json")
            payload = {"operator": "Ekonovus", "code": code, "municipality": name,
                       "count": len(entries), "entries": entries}
            meta = write_json(path, payload, source="ekonovus/powerbi",
                              request={"code": code, "municipality": name})
            index.append({"operator": "Ekonovus", "code": code, "municipality": name,
                          "count": len(entries), "file": os.path.basename(path),
                          "bytes": meta["bytes"]})
            print(f"  {code} {name:<24} {len(entries):>7} -> {meta['bytes']/1e6:.2f} MB")
        except OSError as e:
            failed.append((code, name, str(e)))
            print(f"  {code} {name:<24} FAILED ({e}) — previous file kept")

    write_json(os.path.join(args.out, "index.json"),
               {"generated": time.strftime("%Y-%m-%d"), "areas": index},
               source="ekonovus/powerbi")
    print(f"\nwrote {len(index)} municipality files to {args.out}")

    if failed:
        print(f"\n{len(failed)} municipalities failed:", file=sys.stderr)
        for code, name, err in failed:
            print(f"   {code} {name}: {err}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
