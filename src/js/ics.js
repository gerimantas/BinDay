/* ------------------------------------------------------------------
   ICS export

   Every pickup is written as its own VEVENT rather than one RRULE. Švara's
   own feed uses RRULE (every 2nd Tuesday), which cannot express the off-cycle
   runs that do occur — those would silently vanish from the calendar. Explicit
   events cost a few KB and stay correct.

   VALARM fires at -PT7H against an all-day event (00:00), i.e. 17:00 the
   previous day, matching the operator's "put bins out the evening before".
------------------------------------------------------------------ */
function icsEscape(s) {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;')
          .replace(/,/g, '\\,').replace(/\n/g, '\\n');
}

/* RFC 5545 caps lines at 75 *octets*, not characters — Lithuanian ž/ų/ė take two
   bytes each in UTF-8, so counting characters overshoots the limit on exactly the
   lines that contain the address. Google and Apple tolerate over-long lines but
   Outlook truncates them, which would silently drop the location.

   Fold on a byte budget, and never split a multi-byte character in half. */
function fold(line) {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;

  const out = [];
  let cur = '';
  let budget = 75;          // first line: no leading space
  for (const ch of line) {  // iterate code points, not UTF-16 units
    const size = enc.encode(ch).length;
    if (enc.encode(cur).length + size > budget) {
      out.push(cur);
      cur = ch;
      budget = 74;          // continuation lines lose one octet to the space
    } else {
      cur += ch;
    }
  }
  if (cur) out.push(cur);
  return out[0] + out.slice(1).map(s => '\r\n ' + s).join('');
}

function stamp(d) {
  const p = n => String(n).padStart(2, '0');
  return d.getUTCFullYear() + p(d.getUTCMonth() + 1) + p(d.getUTCDate()) +
         'T' + p(d.getUTCHours()) + p(d.getUTCMinutes()) + p(d.getUTCSeconds()) + 'Z';
}

function buildICS(entries) {
  const now = new Date();
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//BinDay//Waste Schedule//LT',
    'CALSCALE:GREGORIAN',
    'X-WR-CALNAME:Atliekų išvežimas',
    'X-WR-TIMEZONE:Europe/Vilnius'
  ];

  for (const e of entries) {
    const compact = e.iso.replace(/-/g, '');
    const end = isoLocal(new Date(parseISO(e.iso).getTime() + 864e5)).replace(/-/g, '');
    // One ordering throughout the event — rarest bin first — so the marks and the
    // words line up instead of reading in opposite directions.
    const ordered = [...e.types].sort((a, b) => a.dates.length - b.dates.length);
    const names = ordered.map(c => c.label).join(', ');
    const detail = ordered.map(c => `${c.emoji} ${c.label} (${c.id})`).join('\n');

    // Colour coding has to survive into the calendar, and no reliable mechanism
    // exists: RFC 7986 COLOR is ignored by Google, and per-event colours can only
    // be set through each provider's own API. Emoji in the title is the one thing
    // that renders identically everywhere, so the marks lead the summary — one
    // circle per bin, matching the app's red / yellow / green.
    // Rarest bin first: in a truncated calendar cell the leading mark is the one
    // that survives, and that should be the pickup you cannot afford to miss.
    const marks = ordered.map(c => c.emoji).join('');

    lines.push(
      'BEGIN:VEVENT',
      // Stable UID per day: re-importing updates the event instead of duplicating it.
      `UID:binday-${compact}@binday.local`,
      `DTSTAMP:${stamp(now)}`,
      `DTSTART;VALUE=DATE:${compact}`,
      `DTEND;VALUE=DATE:${end}`,
      fold(`SUMMARY:${marks} ${icsEscape(names)}`),
      fold(`DESCRIPTION:${icsEscape(detail)}`),
      fold(`LOCATION:${icsEscape(getActiveAddress())}`),
      // Honoured by Apple Calendar and anything else implementing RFC 7986;
      // harmless where it isn't. A day can hold several bins but only one colour,
      // so it goes to the rarest one due — glass never falls on its own here, and
      // missing it costs 84 days, so it should win over the fortnightly mixed bin.
      `COLOR:${ordered[0].color}`,
      'TRANSP:TRANSPARENT',
      // Two reminders the evening before, against an all-day event (00:00), so the
      // offsets count back from midnight: -PT7H is 17:00, -PT4H is 20:00. The first
      // catches you while there's still daylight, the second before bed — a single
      // alert is easy to dismiss and then forget with the bins still inside.
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      fold(`DESCRIPTION:${icsEscape('Rytoj išveža: ' + names)}`),
      'TRIGGER:-PT7H',
      'END:VALARM',
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      fold(`DESCRIPTION:${icsEscape('Paskutinis priminimas — rytoj išveža: ' + names)}`),
      'TRIGGER:-PT4H',
      'END:VALARM',
      'END:VEVENT'
    );
  }

  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

function downloadICS(entries) {
  const blob = new Blob([buildICS(entries)], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'binday.ics';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  markExported(entries);
}

/* What was last put into the calendar from this phone, so the button can say
   whether the calendar is current. The app cannot see the calendar itself — it
   only knows what it handed over, so "įkelta" means "the file was opened here".

   Keyed by the address's container ids rather than the saved-address index: the
   index shifts when an address is removed, the containers do not. Each pickup is
   stored as "date|ids", so a bin added to an existing day counts as a change. */
const CAL_STORE = 'binday.calendar';

function calendarKey() {
  return getSchedule().map(c => c.id).sort().join(',');
}

function pickupSig(e) {
  return e.iso + '|' + e.types.map(c => c.id).sort().join(',');
}

function loadExports() {
  try { return JSON.parse(localStorage.getItem(CAL_STORE) || '{}') || {}; }
  catch (e) { return {}; }
}

function markExported(entries) {
  const all = loadExports();
  all[calendarKey()] = { at: isoLocal(new Date()), pickups: entries.map(pickupSig) };
  try { localStorage.setItem(CAL_STORE, JSON.stringify(all)); }
  catch (e) { /* private mode: the button just keeps saying "not yet" */ }
}

/* none: never exported for this address. current: the calendar holds every
   upcoming pickup. stale: pickups were added, changed or cancelled since the
   export — re-importing fixes the first two (UIDs are per date), but a cancelled one stays
   in the calendar until deleted by hand, so those dates are listed. */
function exportState(upcoming, today) {
  const last = loadExports()[calendarKey()];
  if (!last || !Array.isArray(last.pickups)) return { kind: 'none' };
  const had = new Set(last.pickups);
  const days = new Set(upcoming.map(e => e.iso));
  // New or changed days: one event per day, so re-importing fixes both.
  const changed = upcoming.filter(e => !had.has(pickupSig(e))).length;
  // A day gone entirely has no event to overwrite it.
  const cancelled = last.pickups
    .map(s => s.slice(0, 10))
    .filter(iso => iso >= today && !days.has(iso));
  if (!changed && !cancelled.length) return { kind: 'current', at: last.at };
  return { kind: 'stale', at: last.at, changed, cancelled };
}

/* Lithuanian count agreement: 1 / 21 data, 2–9 datos, 10–20 / 30 datų. */
function ltCount(n, one, few, many) {
  const tens = n % 100, ones = n % 10;
  const word = (tens >= 10 && tens <= 20) || ones === 0 ? many : ones === 1 ? one : few;
  return `${n} ${word}`;
}

/* A single `now` per render keeps every relative label consistent — no chance
   of the hero saying "tomorrow" while a row says "today" after a midnight tick. */
function refresh() { render(new Date()); }
