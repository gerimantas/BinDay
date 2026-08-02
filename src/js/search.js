/* Švara and Ekonovus write the same place differently — "Žalgirio g. 8A,
   Juragių k., …" vs "Juragių k. Žalgirio g. 8A" — so matching is done on a
   normalised bag of words rather than on the string as written. */
function normalise(s) {
  return (s || '').toLowerCase()
    .replace(/[.,]/g, ' ')
    .replace(/\b(g|gatvė|k|kaimas|mstl|mst|m|vs|sen|sav|r|al|tak|pr)\b/g, ' ')
    .replace(/\s+/g, ' ').trim();
}
function tokens(s) { return normalise(s).split(' ').filter(Boolean); }

/* The two operators describe one property differently — Švara writes
   "Žalgirio g. 8A, Juragių k., Garliavos apylinkių sen. Kauno r. sav." and
   Ekonovus "Juragių k. Žalgirio g. 8A". Grouping on the raw string would
   offer the same house twice, each with half its bins, and whichever the
   user picked would quietly omit the others. Group on the sorted word bag
   instead so both operators' containers land on one result. */
function addressKey(s) {
  /* Švara appends the seniūnija and savivaldybė ("…, Garliavos apylinkių sen.
     Kauno r. sav."), Ekonovus does not. Comparing whole word bags therefore
     never matches. The house number plus the two most specific name words —
     street and locality — identify the property, and both operators carry
     those. */
  const t = tokens(s);
  const house = t.filter(w => /\d/.test(w));
  const words = t.filter(w => !/\d/.test(w));
  const key = words.slice(0, 2).sort().concat(house.sort());
  return key.join(' ');
}

/* Rows arrive already merged on (locality, street, house, flat) — the build did
   the grouping, so one row is one property carrying every container both
   operators serve at it. This only filters and ranks.

   Flats are separate rows on purpose and must stay separate here: 60% of Švara
   multi-flat buildings have a different schedule per flat, so offering one row
   for the building would hand a resident the neighbour's dates. */
function searchAddresses(entries, query, limit = 12) {
  const q = tokens(query);
  if (!q.length) return [];
  const hits = [];
  for (const e of entries) {
    const hay = normalise(e.address);
    if (!q.every(t => hay.includes(t))) continue;
    hits.push(e);
    if (hits.length > limit * 8) break;
  }
  /* Rank an exact house-number match first: a search for "8A" otherwise puts
     "28A" above it, because "8a" is a substring of "28a". */
  return hits
    .sort((a, b) => exactness(b, q) - exactness(a, q) || a.address.length - b.address.length)
    .slice(0, limit);
}

function exactness(hit, queryTokens) {
  const words = tokens(hit.address);
  return queryTokens.filter(t => words.includes(t)).length;
}

/* Operators spell one property at very different lengths — Švara's
   "Žalgirio g. 8A, Juragių k., Garliavos apylinkių sen. Kauno r. sav." wraps to three
   lines on a phone and repeats the municipality the user just chose. Keep the street,
   house and locality; drop the administrative tail. */
function shortAddress(s) {
  const parts = String(s).split(',').map(x => x.trim()).filter(Boolean);
  if (parts.length > 1) {
    const keep = parts.filter(p => !/\b(sen|sav)\.?$/i.test(p));
    return (keep.length ? keep : parts).slice(0, 2).join(', ');
  }
  return s;
}

/* Distinct waste types, in a stable order, as coloured dots. */
const TYPE_ORDER = ['MIXED', 'PACKAGING', 'GLASS', 'GREEN', 'PAPER', 'RECYCLABLE', 'OTHER'];
function distinctTypes(containers) {
  const seen = new Set(containers.map(c => c.type));
  return TYPE_ORDER.filter(t => seen.has(t))
    .concat([...seen].filter(t => !TYPE_ORDER.includes(t)));
}
function typeDots(containers) {
  return distinctTypes(containers).map(t => {
    const m = TYPE_META[t] || TYPE_META.OTHER;
    const dot = document.createElement('span');
    dot.className = 'tdot';
    dot.style.background = m.color;
    dot.title = m.label;
    return dot;
  });
}
