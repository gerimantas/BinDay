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
      fold(`LOCATION:${icsEscape(ADDRESS)}`),
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
}

/* A single `now` per render keeps every relative label consistent — no chance
   of the hero saying "tomorrow" while a row says "today" after a midnight tick. */
function refresh() { render(new Date()); }
