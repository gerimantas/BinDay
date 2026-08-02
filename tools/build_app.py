#!/usr/bin/env python3
"""Assemble src/ into the single index.html that ships.

    python tools/build_app.py            # writes index.html, bumps sw.js CACHE
    python tools/build_app.py --check    # verify index.html matches src/, write nothing

index.html stays one file by decision — the app must work offline at the kerb and a
build step for the *user* would add nothing. What changes here is the source: the
concerns already visible as sections in the old file become their own modules, and this
script inlines them back in dependency order.

Concatenation only. No module loader, no bundler, no import/export in the sources —
they are plain scripts sharing one scope, exactly as before, so the output is the same
kind of file the browser already runs. ORDER lists them explicitly rather than globbing:
these files depend on each other, and alphabetical order would be wrong.

Bumping CACHE in sw.js is part of the build, not a step someone must remember. The
worker is cache-first, so a stale CACHE is the single most common way a correct fix
fails to reach the phone.
"""

import io
import os
import re
import sys

SRC = "src"
OUT = "index.html"
SW = "sw.js"

# Dependency order, not alphabetical. data.js defines the schedule accessors every
# other module reads; main.js wires up listeners and must run last.
ORDER = [
    "data.js",       # ADDRESS, DEFAULT_SCHEDULE, get/setActiveSchedule, weekday names
    "dates.js",      # isoLocal, parseISO, daysBetween, prettyDate, relativeLabel
    "calendar.js",   # buildCalendar
    "render.js",     # expanded flag, render
    "ics.js",        # icsEscape, fold, stamp, buildICS, downloadICS, refresh
    "catalog.js",    # STORE, CATALOG, TYPE_META, loadSaved, persist, getIndex, getArea
    "search.js",     # normalise, tokens, addressKey, searchAddresses, typeDots
    "settings.js",   # the sheet: renderSaved, fillAreas, doSearch, locate, applyActive
    "main.js",       # listeners and startup only
]


def read(path):
    return io.open(path, encoding="utf-8").read()


def build_js():
    parts = []
    for name in ORDER:
        path = os.path.join(SRC, "js", name)
        if not os.path.exists(path):
            sys.exit(f"missing source: {path}")
        body = read(path).strip("\n")
        parts.append(f"/* ===== {name} ===== */\n{body}")
    return "\n\n".join(parts)


def build_html():
    shell = read(os.path.join(SRC, "index.html"))
    css = read(os.path.join(SRC, "styles.css")).strip("\n")
    js = build_js()

    if "<!--STYLES-->" not in shell or "<!--SCRIPTS-->" not in shell:
        sys.exit("src/index.html must contain <!--STYLES--> and <!--SCRIPTS--> markers")

    # Substitute via a function so a backslash or \g in the CSS/JS is not read as a
    # regex escape — re.sub interprets those in a string replacement.
    html = shell.replace("<!--STYLES-->", "<style>\n" + css + "\n</style>")
    html = html.replace("<!--SCRIPTS-->", "<script>\n" + js + "\n</script>")
    return html


def current_cache():
    m = re.search(r"const CACHE = 'binday-v(\d+)';", read(SW))
    if not m:
        sys.exit("could not find CACHE in sw.js")
    return int(m.group(1))


def bump_cache():
    n = current_cache()
    text = read(SW).replace(f"const CACHE = 'binday-v{n}';",
                            f"const CACHE = 'binday-v{n + 1}';")
    io.open(SW, "w", encoding="utf-8", newline="\n").write(text)
    return n + 1


def main():
    check = "--check" in sys.argv
    html = build_html()

    if check:
        if not os.path.exists(OUT):
            sys.exit(f"{OUT} does not exist")
        # Compare with newlines normalised: the repo stores CRLF while the sources are
        # LF, so a raw comparison fails for a reason that does not matter.
        a = read(OUT).replace("\r\n", "\n")
        b = html.replace("\r\n", "\n")
        if a != b:
            sys.exit(f"{OUT} is out of date — run: python tools/{os.path.basename(__file__)}")
        print(f"{OUT} matches {SRC}/ ({len(b)} bytes)")
        return

    previous = read(OUT).replace("\r\n", "\n") if os.path.exists(OUT) else None
    io.open(OUT, "w", encoding="utf-8", newline="\n").write(html)

    if previous == html.replace("\r\n", "\n"):
        print(f"{OUT} unchanged ({len(html)} bytes) — CACHE left at "
              f"binday-v{current_cache()}")
    else:
        version = bump_cache()
        print(f"{OUT} written ({len(html)} bytes), CACHE bumped to binday-v{version}")


if __name__ == "__main__":
    main()
