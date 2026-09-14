#!/usr/bin/env python3
"""Extract Švara pickup dates from the operator's own PDF calendar.

This is the cheapest and most reliable path when the container's `hashedId` is known —
no browser, no firecrawl credits, no vision step that can misread a day:

    curl -s "https://grafikai.svara.lt/api/download/EKzJW7DK" -o schedule.pdf
    python svara_from_pdf.py schedule.pdf

The PDF is a rendered month grid. `extract_text()` returns the day numbers but nothing
about which ones are collection days — those are drawn as red rectangles behind the digits.
So the extraction works geometrically: find every rect filled with Švara's red, read the
characters inside its bounds, and map the rect's x-position to a month column.

Output: JSON array of ISO dates on stdout.
"""

import argparse
import json
import re
import sys

for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8")
    except (AttributeError, ValueError):
        pass

# Fill colour of a marked collection day. Compared with tolerance because PDF colour
# values round-trip through floats.
RED = (0.8431, 0.2275, 0.2275)
TOLERANCE = 0.02

LT_MONTHS = {
    "SAUSIS": 1, "VASARIS": 2, "KOVAS": 3, "BALANDIS": 4,
    "GEGUŽĖ": 5, "BIRŽELIS": 6, "LIEPA": 7, "RUGPJŪTIS": 8,
    "RUGSĖJIS": 9, "SPALIS": 10, "LAPKRITIS": 11, "GRUODIS": 12,
}


def is_red(colour):
    if not colour or len(colour) != 3:
        return False
    return all(abs(a - b) <= TOLERANCE for a, b in zip(colour, RED))


def month_headers(page):
    """Return month captions as [(x_center, top, month_number)], in reading order.

    The calendar is a grid — Švara's year runs LIEPA…BIRŽELIS across 4 rows of 3 columns.
    A day cell therefore belongs to the caption that is both in its column *and* directly
    above it; matching on x alone silently assigns every row to the first month in that
    column, which is what produced a schedule spanning 2026–2034 on the first attempt.
    """
    found = []
    for word in page.extract_words():
        name = word["text"].strip().upper()
        if name in LT_MONTHS:
            found.append(
                ((word["x0"] + word["x1"]) / 2, word["top"], LT_MONTHS[name])
            )
    # Reading order: top to bottom, then left to right.
    return sorted(found, key=lambda h: (round(h[1]), h[0]))


def owning_month(x_center, top, headers):
    """The caption in the same column that sits closest above this cell."""
    above = [h for h in headers if h[1] < top]
    if not above:
        return None, None
    # Column first (captions are ~170pt apart horizontally, rows ~120pt vertically), then
    # the lowest caption still above the cell.
    same_column = [h for h in above if abs(h[0] - x_center) < 90]
    candidates = same_column or above
    best = max(candidates, key=lambda h: h[1])
    return best[2], best[1]


def extract(pdf_path):
    import pdfplumber

    dates = set()
    year_hint = None

    with pdfplumber.open(pdf_path) as pdf:
        # The title carries the covered years, e.g. "2026 - 2027 metų ... grafikas".
        head = pdf.pages[0].extract_text() or ""
        years = [int(y) for y in re.findall(r"\b(20\d{2})\b", head)]
        year_hint = min(years) if years else None

        for page in pdf.pages:
            headers = month_headers(page)
            if not headers:
                continue

            # Walk the captions in reading order and assign each a year: the calendar
            # starts mid-year, so the year advances at every backwards month wrap
            # (…GRUODIS → SAUSIS…). Keying by caption position rather than by cell keeps
            # every day in a month tied to the same year.
            year_of = {}
            year = year_hint if year_hint is not None else 0
            prev_month = None
            for x, top, month in headers:
                if prev_month is not None and month < prev_month:
                    year += 1
                prev_month = month
                year_of[(round(x), round(top))] = year

            reds = [r for r in page.rects if is_red(r.get("non_stroking_color"))]
            for rect in reds:
                inside = [
                    ch["text"]
                    for ch in page.chars
                    if rect["x0"] <= ch["x0"] <= rect["x1"]
                    and rect["top"] <= ch["top"] <= rect["bottom"]
                ]
                text = "".join(inside).strip()
                if not text.isdigit():
                    continue
                day = int(text)
                if not 1 <= day <= 31:
                    continue

                x_center = (rect["x0"] + rect["x1"]) / 2
                month, header_top = owning_month(x_center, rect["top"], headers)
                if month is None:
                    continue

                # Recover the caption this cell belongs to, to read its year.
                match = [
                    k for k in year_of
                    if abs(k[1] - header_top) < 2 and abs(k[0] - x_center) < 90
                ]
                if not match:
                    continue
                dates.add((year_of[match[0]], month, day))

    if year_hint is None:
        print("ERROR: could not read a year from the PDF title", file=sys.stderr)
        sys.exit(2)

    return sorted(f"{y:04d}-{m:02d}-{d:02d}" for y, m, d in dates)


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("pdf", help="PDF downloaded from /api/download/<hashedId>")
    args = ap.parse_args()

    try:
        dates = extract(args.pdf)
    except ImportError:
        print("ERROR: pdfplumber is required — pip install pdfplumber", file=sys.stderr)
        sys.exit(1)

    print(json.dumps(dates, indent=2))

    if not dates:
        print(
            "ERROR: no marked days found. Either the PDF layout changed or the fill "
            "colour is no longer %r — inspect page.rects before trusting this." % (RED,),
            file=sys.stderr,
        )
        sys.exit(2)

    # A wrong month-column mapping shows up as a nonsense interval far more clearly than
    # as a wrong-looking date, so surface it here rather than leaving it to the caller.
    from datetime import date as _date

    ds = [_date.fromisoformat(d) for d in dates]
    gaps = sorted({(b - a).days for a, b in zip(ds, ds[1:])})
    print(f"note: {len(dates)} dates, intervals {gaps} days", file=sys.stderr)
    if any(g > 40 for g in gaps):
        print(
            "WARNING: a gap over 40 days usually means a month column was mapped wrong. "
            "Cross-check against the PDF before using these dates.",
            file=sys.stderr,
        )


if __name__ == "__main__":
    main()
