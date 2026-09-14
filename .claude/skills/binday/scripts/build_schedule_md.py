#!/usr/bin/env python3
"""Turn scraped pickup dates into the canonical schedule markdown.

Input is a JSON file describing the address and one entry per container:

    {
      "address": "Zalgirio g. 8A, Juragiu k., Garliavos apylinkiu sen., Kauno r. sav.",
      "collected": "2026-07-30",
      "containers": [
        {"type": "MIXED", "id": "52-MK-036668", "operator": "UAB Kauno svara",
         "source": "https://grafikai.svara.lt/", "dates": ["2026-08-04", ...]},
        ...
      ]
    }

Run:  python build_schedule_md.py input.json -o Atlieku_isvezimo_grafikai.md

Why this is a script and not prose instructions: the interval/weekday consistency check
below is the step that catches bad scrapes. A schedule with a stray 13-day gap almost
always means the browser read a highlighted day wrong, and that is very hard to notice by
eye in a 40-row table. Failing loudly here beats shipping a wrong calendar.
"""

import argparse
import json
import sys
from collections import Counter
from datetime import date

# On Windows the console defaults to cp1252, which cannot encode Lithuanian diacritics —
# any warning naming a street would crash the script instead of printing. Force UTF-8 on
# the streams we write to.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8")
    except (AttributeError, ValueError):
        pass

LT_MONTH_GEN = [
    "sausio", "vasario", "kovo", "balandžio", "gegužės", "birželio",
    "liepos", "rugpjūčio", "rugsėjo", "spalio", "lapkričio", "gruodžio",
]
LT_DAY_ABBR = ["Pir.", "Ant.", "Tre.", "Ket.", "Pen.", "Šeš.", "Sekm."]

TYPE_LABEL = {
    "MIXED": "mišrios komunalinės",
    "PACKAGING": "pakuotės",
    "GLASS": "stiklas",
    "BIO": "biologinės",
    "PAPER": "popierius",
}


def analyse(dates):
    """Return (intervals, weekdays) so callers can judge how regular a schedule is."""
    ds = [date.fromisoformat(d) for d in dates]
    intervals = sorted({(b - a).days for a, b in zip(ds, ds[1:])})
    weekdays = sorted({d.weekday() for d in ds})
    return ds, intervals, weekdays


def check(container):
    """Warn about anything that smells like a misread date.

    These are warnings, not errors: a real schedule can legitimately shift around public
    holidays. But an irregular gap is worth a human glance before the file is trusted.
    """
    warns = []
    dates = container["dates"]
    cid = container.get("id", container.get("type", "?"))

    if not dates:
        return [f"{cid}: no dates at all — the scrape almost certainly failed"]
    if len(dates) != len(set(dates)):
        dupes = [d for d, n in Counter(dates).items() if n > 1]
        warns.append(f"{cid}: duplicate dates {dupes}")
    if dates != sorted(dates):
        warns.append(f"{cid}: dates are not in chronological order")

    ds, intervals, weekdays = analyse(sorted(set(dates)))
    if len(intervals) > 1:
        warns.append(
            f"{cid}: irregular intervals {intervals} days — expected a single value. "
            "Check for a misread or a holiday shift."
        )
    if len(weekdays) > 1:
        names = [LT_DAY_ABBR[w] for w in weekdays]
        warns.append(f"{cid}: dates fall on several weekdays ({', '.join(names)})")
    if len(dates) < 3:
        warns.append(f"{cid}: only {len(dates)} dates — operator range may be truncated")
    return warns


def date_rows(dates):
    out = []
    for i, iso in enumerate(sorted(set(dates))):
        d = date.fromisoformat(iso)
        gap = str((d - date.fromisoformat(sorted(set(dates))[i - 1])).days) if i else "—"
        pretty = f"{d.day} {LT_MONTH_GEN[d.month - 1]} {d.year}"
        out.append(f"| {iso} | {LT_DAY_ABBR[d.weekday()]} | {pretty} | {gap} |")
    return "\n".join(out)


def merged_rows(containers):
    events = {}
    for c in containers:
        for iso in c["dates"]:
            events.setdefault(iso, []).append(c["type"])
    rows = []
    for iso in sorted(events):
        d = date.fromisoformat(iso)
        rows.append(f"| {iso} | {LT_DAY_ABBR[d.weekday()]} | {', '.join(events[iso])} |")
    return "\n".join(rows), events


def build(data):
    containers = [c for c in data["containers"] if c.get("dates")]
    for c in containers:
        c["dates"] = sorted(set(c["dates"]))
        ds, intervals, weekdays = analyse(c["dates"])
        c["_interval"] = intervals[0] if len(intervals) == 1 else None
        c["_weekday"] = LT_DAY_ABBR[weekdays[0]] if len(weekdays) == 1 else "—"
        c["_until"] = c["dates"][-1]
        c["_anchor"] = c["dates"][0]

    parts = []
    parts.append(f"# Atliekų išvežimo grafikai — {data['address']}\n")
    parts.append(f"Adresas: **{data['address']}**\n")
    parts.append(f"Duomenys surinkti: {data['collected']}\n")

    parts.append("Šaltiniai:")
    for src in sorted({c["source"] for c in containers}):
        ops = sorted({c["operator"] for c in containers if c["source"] == src})
        parts.append(f"- `{src}` ({', '.join(ops)})")
    parts.append("")

    legend = ", ".join(
        f"`{c['type']}` = {TYPE_LABEL.get(c['type'], c['type'].lower())}" for c in containers
    )
    parts.append(f"Tipai: {legend}\n")

    parts.append("## Konteineriai\n")
    parts.append(
        "| Tipas | Konteinerio Nr. | Operatorius | Intervalas | Savaitės diena | Datų sk. | Aprėptis iki |"
    )
    parts.append(
        "|-------|-----------------|-------------|-----------|----------------|----------|--------------|"
    )
    for c in containers:
        iv = f"{c['_interval']} d." if c["_interval"] else "nereguliarus"
        parts.append(
            f"| {c['type']} | {c['id']} | {c['operator']} | {iv} | "
            f"{c['_weekday']} | {len(c['dates'])} | {c['_until']} |"
        )
    parts.append("")

    for c in containers:
        label = TYPE_LABEL.get(c["type"], c["type"].lower())
        parts.append(f"## {c['type']} — {label} ({c['id']})\n")
        parts.append("| Data | Diena | Aprašymas | Dienų nuo praėjusio |")
        parts.append("|------|-------|-----------|---------------------|")
        parts.append(date_rows(c["dates"]))
        parts.append("")

    rows, events = merged_rows(containers)
    parts.append("## Bendras kalendorius\n")
    parts.append("Visos datos viename sąraše, chronologiškai. Sutampančios dienos sujungtos.\n")
    parts.append("| Data | Diena | Tipai |")
    parts.append("|------|-------|-------|")
    parts.append(rows)
    parts.append("")

    all_types = {c["type"] for c in containers}
    overlaps = [iso for iso, t in events.items() if set(t) == all_types]
    total = sum(len(c["dates"]) for c in containers)
    parts.append("## Statistika\n")
    for c in containers:
        if c["_interval"]:
            iv = f"kas {c['_interval']} dienų"
        else:
            _, ivs, _ = analyse(c["dates"])
            iv = f"nereguliariai (intervalai: {', '.join(str(i) for i in ivs)} d.)"
        parts.append(f"- {c['type']}: {len(c['dates'])} išvežimai, {iv}")
    parts.append(f"- **Iš viso:** {total} išvežimai")
    if overlaps:
        parts.append(f"- Dienos, kai išvežami visi tipai: {', '.join(sorted(overlaps))}")
    parts.append(
        f"- Ankstyviausia data: {min(events)} · Vėliausia: {max(events)}"
    )
    parts.append("")

    parts.append("## Pastabos\n")
    for note in data.get("notes", []):
        parts.append(f"- {note}")
    parts.append(
        "- Grafikai yra operatorių skelbiami planai ir gali keistis. "
        "Aprėptis skirtinga kiekvienam operatoriui — po `until` datos reikia perscrapinti šaltinį."
    )
    parts.append("")

    parts.append("## Konvertavimas į app formatą\n")
    parts.append(
        "Datos saugomos kaip operatoriaus paskelbtas sąrašas, ne kaip `anchor + intervalDays`. "
        "Švaros grafike pasitaiko nuokrypių (buvo pirmadieninių išvežimų ir papildomas "
        "trečiadienį), todėl skaičiuojantis app tyliai praleistų tas dienas.\n"
    )
    parts.append("```javascript")
    parts.append("const CONTAINERS = [")
    for c in containers:
        iv = c["_interval"]
        note = f"  // {c['type']}: kas {iv} d." if iv else f"  // {c['type']}: nereguliarus"
        parts.append(note)
        dates_js = ", ".join(f'"{d}"' for d in c["dates"])
        parts.append(
            f'  {{ type: "{c["type"]}", id: "{c["id"]}", operator: "{c["operator"]}",'
        )
        parts.append(f'    until: "{c["_until"]}", dates: [{dates_js}] }},')
    parts.append("];")
    parts.append("")
    parts.append("// Next pickup on or after `now`, looked up in the published list.")
    parts.append("// Returns null past the operator's range — that means re-scrape, not 'no pickups'.")
    parts.append("function nextPickup(c, now) {")
    parts.append("  const iso = new Date(now).toISOString().slice(0, 10);")
    parts.append("  return c.dates.find(d => d >= iso) ?? null;")
    parts.append("}")
    parts.append("")
    parts.append("// True when the published window is running out and a refresh is due.")
    parts.append("function needsRefresh(c, now, daysAhead = 30) {")
    parts.append("  const limit = new Date(now.getTime() + daysAhead * 864e5)")
    parts.append("    .toISOString().slice(0, 10);")
    parts.append("  return c.until < limit;")
    parts.append("}")
    parts.append("```")
    parts.append("")
    return "\n".join(parts)


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("input", help="JSON file with address + containers")
    ap.add_argument("-o", "--output", default="Atlieku_isvezimo_grafikai.md")
    ap.add_argument(
        "--keep-past",
        action="store_true",
        help="keep dates before `collected`. By default they are dropped — operators "
        "return a window that starts in the past, and past dates pad the app's list "
        "with pickups that already happened.",
    )
    args = ap.parse_args()

    with open(args.input, encoding="utf-8") as fh:
        data = json.load(fh)

    if not args.keep_past:
        cutoff = data["collected"]
        for c in data["containers"]:
            kept = [d for d in c.get("dates", []) if d >= cutoff]
            dropped = len(c.get("dates", [])) - len(kept)
            if dropped:
                print(
                    f"note: {c.get('id', c.get('type'))}: dropped {dropped} date(s) "
                    f"before {cutoff}",
                    file=sys.stderr,
                )
            c["dates"] = kept

    warnings = [w for c in data["containers"] for w in check(c)]
    for w in warnings:
        print(f"WARNING: {w}", file=sys.stderr)

    md = build(data)
    with open(args.output, "w", encoding="utf-8") as fh:
        fh.write(md)

    print(f"wrote {args.output} ({len(md)} bytes)", file=sys.stderr)
    if warnings:
        print(
            f"{len(warnings)} warning(s) above — verify against the source before trusting the file.",
            file=sys.stderr,
        )


if __name__ == "__main__":
    main()
