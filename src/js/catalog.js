/* ------------------------------------------------------------------
   Settings — saved addresses, catalogue lookup, geolocation

   The catalogue is fetched from data/catalog/ as static JSON. Only
   municipalities served by BOTH operators ship data; a single-operator
   area would show packaging without mixed waste (or the reverse), and a
   schedule that silently omits a bin is worse than none. Those areas are
   listed as `pending` and the app says so.
------------------------------------------------------------------ */
const CATALOG = 'data/catalog/';
const TYPE_META = {
  MIXED:     { label: 'Mišrios',  emoji: '🔴', color: 'red' },
  PACKAGING: { label: 'Pakuotės', emoji: '🟡', color: 'gold' },
  GLASS:     { label: 'Stiklas',  emoji: '🟢', color: 'springgreen' },
  GREEN:     { label: 'Žaliosios', emoji: '🟤', color: 'olivedrab' },
  PAPER:     { label: 'Popierius', emoji: '🔵', color: 'deepskyblue' },
  OTHER:     { label: 'Kita',     emoji: '⚪', color: 'gainsboro' }
};

let areasIndex = null;              // areas.json
const areaCache = new Map();        // file -> entries[]

async function getIndex() {
  if (!areasIndex) {
    const r = await fetch(CATALOG + 'areas.json');
    if (!r.ok) throw new Error('index ' + r.status);
    areasIndex = await r.json();
  }
  return areasIndex;
}

async function getArea(files) {
  const out = [];
  for (const f of files) {
    if (!areaCache.has(f.file)) {
      const r = await fetch(CATALOG + f.file);
      if (!r.ok) throw new Error(f.file + ' ' + r.status);
      areaCache.set(f.file, (await r.json()).entries);
    }
    for (const e of areaCache.get(f.file)) {
      out.push({ address: e[0], id: e[1], type: e[2], hashedId: e[3] || null,
                 operator: f.operator });
    }
  }
  return out;
}
