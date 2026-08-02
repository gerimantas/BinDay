/* Merge every container's dates into one day-keyed calendar: one row per day
   listing the bins due, which is how the bins actually get taken out. */
function buildCalendar() {
  const byDay = new Map();
  for (const c of getSchedule()) {
    for (const iso of c.dates) {
      if (!byDay.has(iso)) byDay.set(iso, []);
      byDay.get(iso).push(c);
    }
  }
  return [...byDay.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([iso, types]) => ({ iso, types }));
}
