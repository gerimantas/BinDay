// Read the Švara schedule for Žalgirio g. 8A from a real browser session.
//
// Since 2026-10 grafikai.svara.lt answers every API call with HTTP 403 unless the
// browser holds a session cookie, and the cookie is issued only after Cloudflare
// Turnstile ("Verify you are human") passes. A GitHub runner cannot pass it, and
// automating past it is not something this project does. So this runs in the user's
// own Chrome through Claude in Chrome:
//   1. navigate a tab to https://grafikai.svara.lt/ — if the checkbox appears, the
//      person ticks it (a session lasts 30 minutes);
//   2. javascript_tool with this file's text as the code, on that tab.
// The page's own fetch carries the session cookie. Without a session the first call
// fails with HTTP 403 and the message below says what to do.
//
// The last expression is the JSON object to save as data/zalgirio_svara.json.

await (async () => {
  if (location.origin !== 'https://grafikai.svara.lt') {
    throw new Error('run this on a grafikai.svara.lt tab, not ' + location.origin);
  }
  // Server function ids change whenever Švara redeploys. On HTTP 404 with a valid
  // session, read the new ids from the site's /assets/index-*.js bundle.
  const CONTRACTS = '924260c2179ab4d80c26bc40c8d42666d1a4bebe81099d4604d0506a4b71e542';
  const SCHEDULE = '2aabda53b9e018ef5c032e882b3c850fa4045931586d492add172a2db09f6f64';
  const INVENTORY = '52-MK-036668';
  const HASHED_ID = 'EKzJW7DK';
  const ADDRESS = {
    region: 'Kauno r. sav.', subDistrict: 'Garliavos apylinkių sen.', city: 'Juragių k.',
    street: 'Žalgirio g.', houseNumber: '8A', matchHouseNumber: true, pageIndex: 0,
  };

  const value = v => typeof v === 'string' ? { t: 1, s: v }
    : typeof v === 'boolean' ? { t: 2, s: v ? 2 : 3 } : { t: 0, s: v };
  const call = async (id, args) => {
    const payload = { t: { t: 10, i: 0, p: { k: ['data'], v: [{ t: 10, i: 1,
      p: { k: Object.keys(args), v: Object.values(args).map(value) }, o: 0 }] }, o: 0 },
      f: 63, m: [] };
    const res = await fetch(`/_serverFn/${id}?payload=` +
      encodeURIComponent(JSON.stringify(payload)),
      { headers: { 'x-tsr-serverFn': 'true', accept: 'application/json' } });
    if (res.status === 403) {
      throw new Error('HTTP 403: no Švara session — reload the page, tick ' +
                      '"Verify you are human", then run this again');
    }
    if (!res.ok) throw new Error(`HTTP ${res.status} from server function ${id.slice(0, 8)}`);
    return res.text();
  };
  // seroval strings are {"t":1,"s":"..."}; pull them out by key position.
  const strings = text => [...text.matchAll(/\{"t":1,"s":"((?:[^"\\]|\\.)*)"\}/g)]
    .map(m => JSON.parse(`"${m[1]}"`));

  // Every contracts field is a Contains match, so read the address back.
  const contracts = strings(await call(CONTRACTS, ADDRESS));
  const fullAddress = contracts.find(s => s.startsWith('Žalgirio g. 8A,'));
  if (!contracts.includes(INVENTORY) || !fullAddress?.includes('Juragių k.')) {
    throw new Error(`contracts did not return ${INVENTORY} at Žalgirio g. 8A, Juragių k.`);
  }
  // The schedule is asked for by hashedId; make sure it still belongs to this bin.
  if (!contracts.includes(HASHED_ID)) {
    throw new Error(`contracts no longer carry hashedId ${HASHED_ID} for ${INVENTORY}`);
  }
  const dates = strings(await call(SCHEDULE, { hashedId: HASHED_ID }))
    .filter(s => /^\d{4}-\d{2}-\d{2}$/.test(s));
  if (!dates.length) throw new Error('schedule returned no dates');
  const d = new Date();
  const checked = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-` +
    String(d.getDate()).padStart(2, '0');
  return { checked, inventory: INVENTORY, hashedId: HASHED_ID, fullAddress,
           dates: [...new Set(dates)].sort() };
})();
