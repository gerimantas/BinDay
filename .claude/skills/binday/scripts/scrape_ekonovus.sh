#!/usr/bin/env bash
# Scrape packaging/glass pickup dates from ekonovus.lt for one container number.
#
# ekonovus.lt/aptarnavimo-grafikai/ is a WordPress page whose only real content is an
# embedded Power BI report. Scraping the WordPress page returns cookie banners and
# nothing else — you must scrape the Power BI URL directly (see PBI_URL below, extracted
# from the iframe's "Open in new window" link).
#
# The report has three slicers: Savivaldybė, Konteinerio adresas, Inventorinis numeris.
# Filtering by inventory (container) number is the most reliable — addresses in the
# report are free-text and often formatted differently than the official address.
#
# DANGER — the unfiltered default is a valid-looking wrong answer. If the slicer fails to
# apply, the report does not error; it serves its default state, which is a complete
# schedule for a real but unrelated container (seen: 13-L-300017, Biržų r. sav.) whose
# dates shift daily. Pass the expected-address argument so the script can catch this.
#
# Usage:
#   ./scrape_ekonovus.sh 52-P-22781 Zalgirio
#   ./scrape_ekonovus.sh 52-P-22781              # unverified — only when the address is unknown
#
# Output: JSON on stdout with nextPickup, dates[], address; progress on stderr.
# Exit codes: 0 ok · 1 could not load · 2 no dates · 3 address mismatch (wrong container)

set -uo pipefail

CONTAINER="${1:?container number required, e.g. 52-P-22781}"
# Optional: a distinctive fragment of the expected address (e.g. "Zalgirio"). When given,
# the script refuses to return a schedule whose address doesn't contain it. See the
# unfiltered-default trap described below — this is the guard against it.
EXPECT_ADDR="${2:-}"

PBI_URL="https://app.powerbi.com/view?r=eyJrIjoiZDg2ZGMzZDQtZTkxNS00NDYwLWIxMmUtYzkyNWQzYWU2Yzc1IiwidCI6IjAwYTZmZGY2LTQ5YzgtNDZhOC1iZGUwLWQzZjhkOTQ4MmYxMSIsImMiOjl9&pageName=ReportSection37789c49a8b21ee7178d"

log() { printf '%s\n' "$*" >&2; }

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

# Waiting for a slot is not enough on a busy machine: another agent can claim it between
# the scrape and the interact, and the two calls are not atomic. Retry the whole pair.
# Power BI renders client-side and is slow — 8s is the shortest wait that reliably lands
# after the visuals paint. A shorter wait yields an empty report shell.
RESULT=""
for attempt in 1 2 3; do
  log "==> attempt $attempt: loading Power BI report"
  # Capture the scrape id: without `-s`, interact attaches to the LAST scrape
  # machine-wide, so a session from another script or another agent silently hijacks the
  # interaction and this returns an empty list while printing normal progress.
  SCRAPE_ERR=$(firecrawl scrape "$PBI_URL" --wait-for 8000 --only-main-content --json 2>&1 >/dev/null) || {
    log "    scrape failed, waiting for a slot and retrying"
    wait_for_slot || exit 1
    continue
  }
  SCRAPE_ID=$(printf '%s' "$SCRAPE_ERR" | grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' | head -1)
  if [ -z "$SCRAPE_ID" ]; then
    log "    no scrape id returned, retrying rather than risk a hijacked session"
    wait_for_slot || exit 1
    continue
  fi

  log "==> attempt $attempt: filtering to container $CONTAINER (session $SCRAPE_ID)"
  RESULT=$(firecrawl interact -s "$SCRAPE_ID" "In the 'Inventorinis numeris' slicer, clear the current selection and select container number $CONTAINER. Then report the 'Kitas aptarnavimas' date, the full 'Aptarnavimu datos:' list, and the 'Konteinerio adresas' shown." 2>&1)

  if printf '%s' "$RESULT" | grep -qE '20[0-9]{2}-[01][0-9]-[0-3][0-9]'; then
    break
  fi
  log "    no dates in response, waiting for a slot and retrying"
  RESULT=""
  wait_for_slot || exit 1
done

if [ -z "$RESULT" ]; then
  log "ERROR: could not read a schedule for $CONTAINER after 3 attempts"
  exit 1
fi

# Exit non-zero on an empty result. Without this the script would print a well-formed
# JSON skeleton with "dates": [] and exit 0, which reads as success to a caller checking
# only the exit code — a silent-empty scrape is the failure mode most likely to end up in
# a published schedule.
printf '%s' "$RESULT" | python -c '
import sys, re, json
# Windows consoles default to cp1252 and mangle both em-dashes and Lithuanian diacritics
# in the error messages below — which is exactly when you most want them readable.
for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8")
    except (AttributeError, ValueError):
        pass
raw = sys.stdin.read()
dates = sorted(set(re.findall(r"20[0-9]{2}-[01][0-9]-[0-3][0-9]", raw)))
# The address line appears as "Konteinerio adresas ...: <value>" in the model prose.
m = re.search(r"[Aa]dresas[^:\n]*:\s*\*{0,2}([^\n*]+)", raw)
print(json.dumps({
    "container": sys.argv[1] if len(sys.argv) > 1 else None,
    "nextPickup": dates[0] if dates else None,
    "dates": dates,
    "address": m.group(1).strip() if m else None,
}, ensure_ascii=False, indent=2))
if not dates:
    print("ERROR: no dates found for " + (sys.argv[1] if len(sys.argv) > 1 else "?") +
          " — the slicer filter probably did not apply. Re-run; do not treat as empty.",
          file=sys.stderr)
    sys.exit(2)

# Guard against the unfiltered-default trap: when a slicer silently fails to apply, Power
# BI serves a complete, plausible schedule for an unrelated container in a different
# municipality. Nothing about the payload looks wrong, so the address is the only tell.
expect = sys.argv[2] if len(sys.argv) > 2 else ""
addr = m.group(1) if m else ""
if expect and expect.lower() not in addr.lower():
    print("ERROR: address mismatch — expected something containing %r but the report "
          "returned %r. The slicer likely did not apply and these dates belong to a "
          "different container. Discard them." % (expect, addr.strip()), file=sys.stderr)
    sys.exit(3)
if expect and not addr:
    print("ERROR: no address in the response, so the filter could not be verified. "
          "Discard these dates.", file=sys.stderr)
    sys.exit(3)
' "$CONTAINER" "$EXPECT_ADDR"
