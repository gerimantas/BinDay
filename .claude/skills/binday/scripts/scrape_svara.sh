#!/usr/bin/env bash
# Scrape mixed municipal waste (mišrios komunalinės) pickup dates from grafikai.svara.lt
#
# The site is a TanStack Start SPA. The backend API sits behind a hashed server-function
# RPC (/_serverFn/<hash>) whose payload format is not worth reverse-engineering — every
# attempt returns "Seroval Error". Driving the real form in a browser is faster and stays
# correct when the frontend changes.
#
# Usage:
#   ./scrape_svara.sh "Kauno r. sav." "Garliavos apylinkiu sen." "Juragiu k." "Zalgirio g." "8A"
#
# Output: JSON array of ISO dates on stdout, progress on stderr.

set -uo pipefail

REGION="${1:?region required, e.g. 'Kauno r. sav.'}"
SUBDISTRICT="${2:?subdistrict required, e.g. 'Garliavos apylinkiu sen.'}"
CITY="${3:?city/village required, e.g. 'Juragiu k.'}"
STREET="${4:?street required, e.g. 'Zalgirio g.'}"
HOUSE="${5:?house number required, e.g. '8A'}"

URL="https://grafikai.svara.lt/"

log() { printf '%s\n' "$*" >&2; }

# Firecrawl allows 2 concurrent browser sessions. A session left open by a previous run
# blocks new ones and there is no reliable way to kill it by id ("Browser session not
# found" even while the slot is held), so wait for the slot to free itself.
wait_for_slot() {
  local tries=0
  until firecrawl --status 2>&1 | grep -qE '(0|1)/2 jobs'; do
    tries=$((tries + 1))
    if [ "$tries" -gt 40 ]; then
      log "ERROR: firecrawl concurrency slots still busy after ~10 min"
      return 1
    fi
    sleep 15
  done
}

log "==> waiting for a free firecrawl slot"
wait_for_slot || exit 1

# Capture the scrape id and pass it to every interact call. Without `-s`, interact
# attaches to the LAST scrape machine-wide — so a leftover session from another script or
# another agent hijacks the interaction. That failure is silent: the script prints all its
# normal progress lines and returns an empty date list.
log "==> opening session on $URL"
SCRAPE_ERR=$(firecrawl scrape "$URL" --wait-for 4000 --json 2>&1 >/dev/null) || {
  log "ERROR: could not open browser session"
  exit 1
}
SCRAPE_ID=$(printf '%s' "$SCRAPE_ERR" | grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' | head -1)
if [ -z "$SCRAPE_ID" ]; then
  log "ERROR: could not read a scrape id — refusing to run against an unknown session"
  exit 1
fi
log "    scrape id $SCRAPE_ID"

# The cascading dropdowns must be filled in order — each one populates the next via an
# API call, so a single combined instruction is more reliable than five separate
# interact calls (each interact call gets its own page handle; state does persist in the
# session, but every extra round trip is another chance to hit the 120s tool timeout).
log "==> filling search form"
firecrawl interact -s "$SCRAPE_ID" "Select region '$REGION', seniunija '$SUBDISTRICT', gyvenviete '$CITY', gatve '$STREET', house number '$HOUSE', click 'Ieskoti', wait for results to load. Then stop." >/dev/null 2>&1

log "==> expanding schedule and reading highlighted dates"
# Ask in natural language rather than scraping the DOM: react-day-picker marks collection
# days with CSS/data attributes that do not survive as data-selected="true" in a static
# query, and the accessibility tree omits the highlight state entirely. The vision-based
# read is what actually works here.
RESULT=$(firecrawl interact -s "$SCRAPE_ID" "Click the 'Isskleisti vezimo grafika' button in the results row. Then navigate the calendar to the earliest available month and, for every month forward until the schedule runs out, read which day numbers are visually highlighted as collection days. Output them as a plain JSON array of ISO dates (YYYY-MM-DD), nothing else." 2>&1)

# Pull ISO dates out of whatever prose wrapped them, and fail loudly on an empty result.
# An empty array printed with exit 0 looks like "this container has no pickups" to a
# caller, which is never true in practice — it means the calendar read failed.
printf '%s' "$RESULT" | grep -oE '20[0-9]{2}-[01][0-9]-[0-3][0-9]' | sort -u | python -c '
import sys, json
dates = [l.strip() for l in sys.stdin if l.strip()]
print(json.dumps(dates, indent=2))
if not dates:
    print("ERROR: no dates read from the calendar. The form may not have submitted, or "
          "the schedule panel never expanded. Re-run; do not treat as empty.",
          file=sys.stderr)
    sys.exit(2)
'
