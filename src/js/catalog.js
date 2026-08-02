/* ------------------------------------------------------------------
   Catalogue lookup — fetched from dist/ as static JSON.

   dist/ is built by tools/build_dist.py and gated by tools/check_dist.py.
   Addresses are already merged there on (locality, street, house, flat), so
   nothing is grouped at runtime: a key in data.json is one property carrying
   every container both operators serve at it.

   The old data/catalog/ layout shipped whole operator catalogues and grouped
   them in the browser. It also 404'd in production, because the directory is
   gitignored — the picker could never load at all.
------------------------------------------------------------------ */
const DIST = 'dist/';

const TYPE_META = {
  MIXED:     { label: 'Mišrios',  emoji: '🔴', color: 'red' },
  PACKAGING: { label: 'Pakuotės', emoji: '🟡', color: 'gold' },
  GLASS:     { label: 'Stiklas',  emoji: '🟢', color: 'springgreen' },
  GREEN:     { label: 'Žaliosios', emoji: '🟤', color: 'olivedrab' },
  PAPER:     { label: 'Popierius', emoji: '🔵', color: 'deepskyblue' },
  OTHER:     { label: 'Kita',     emoji: '⚪', color: 'gainsboro' }
};

let areasIndex = null;              // dist/areas.json
const areaCache = new Map();        // slug -> {operators, addresses}

async function getJSON(path) {
  const r = await fetch(DIST + path);
  if (!r.ok) throw new Error(path + ' ' + r.status);
  return r.json();
}

async function getIndex() {
  if (!areasIndex) areasIndex = await getJSON('areas.json');
  return areasIndex;
}

/* An area's addresses, as rows the search can filter.

   Each container is stored as [id, type, operatorIndex] against the area's own
   `operators` list — repeating the key names for 133 000 containers cost more
   than the data itself. Expanded here, once per area, rather than in the file. */
/* Turn a search hit into the shape setActiveSchedule() takes.

   One entry per container, carrying its own dates — the same shape as
   DEFAULT_SCHEDULE, so render, buildCalendar and the ICS export need no special
   case for a picked address. Containers with no published dates are dropped
   here rather than rendered as empty: an entry with no dates would show as a
   bin that is never collected. applyActive() reports them separately.

   `until` is the last published date, which is what the app's expiry footer
   reads. Never extrapolate past it — that is the operator's horizon, not a
   guess, and Švara's schedule genuinely deviates within it. */
function scheduleFor(hit) {
  return hit.containers
    .filter(c => c.dates && c.dates.length)
    .map(c => {
      const meta = TYPE_META[c.type] || TYPE_META.OTHER;
      const dates = c.dates.slice().sort();
      return {
        type: c.type, label: meta.label, id: c.id,
        emoji: meta.emoji, color: meta.color,
        operator: c.operator, until: dates[dates.length - 1],
        dates
      };
    });
}

async function getArea(slug) {
  if (!areaCache.has(slug)) {
    const d = await getJSON(slug + '/data.json');
    const ops = d.operators || [];
    const labels = d.labels || {};
    const schedules = d.schedules || [];
    const rows = [];
    for (const [key, containers] of Object.entries(d.addresses || {})) {
      const [locality, street, house, flat] = key.split('|');
      rows.push({
        key,
        locality, street, house, flat: flat || null,
        // The operator's own spelling, carried through the build. The key is
        // normalised for matching and reads as "jurag|zalgirio g|8a|".
        address: labels[key] || `${street} ${house}, ${locality}`,
        containers: containers.map(c => ({
          id: c[0], type: c[1], operator: ops[c[2]] || '?',
          // c[3] indexes the area's shared schedule table; absent when the
          // operator publishes no dates for this container. Undefined and
          // "no pickups" are different answers, so the distinction is kept.
          dates: c.length > 3 ? schedules[c[3]] : null
        }))
      });
    }
    areaCache.set(slug, rows);
  }
  return areaCache.get(slug);
}

