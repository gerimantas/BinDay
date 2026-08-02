/* Local-date ISO string. Deliberately not toISOString(), which converts to UTC
   and rolls the date back an hour before midnight in Lithuania — the app would
   claim a pickup was "today" on the evening before. */
function isoLocal(d) {
  const p = n => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

function parseISO(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function daysBetween(fromISO, toISO) {
  return Math.round((parseISO(toISO) - parseISO(fromISO)) / 864e5);
}

function prettyDate(iso) {
  const d = parseISO(iso);
  return d.getDate() + ' ' + MON_GEN[d.getMonth()];
}

function relativeLabel(days) {
  if (days === 0) return 'šiandien';
  if (days === 1) return 'rytoj';
  if (days < 0) return null;
  if (days < 7) return `po ${days} d.`;
  const weeks = Math.round(days / 7);
  return `po ${weeks} sav.`;
}
