// Read the Švara schedule for Žalgirio g. 8A from a real browser session.
//
// Since 2026-10 grafikai.svara.lt answers every API call with HTTP 403 unless the
// browser holds a session cookie, and the cookie is issued only after Cloudflare
// Turnstile ("Verify you are human") passes. A GitHub runner cannot pass it, and
// automating past it is not something this project does. So this runs in a browser
// a person is watching: through the Playwright MCP tool
//   browser_run_code_unsafe  filename=tools/svara_session_dates.js
// If the checkbox appears, the person ticks it; the function waits for that.
//
// Returns the JSON object to save as data/zalgirio_svara.json.

async (page) => {
  // Server function ids change whenever Švara redeploys. On HTTP 403/404 with a
  // valid session, read the new ids from the site's /assets/index-*.js bundle.
  const CONTRACTS = '924260c2179ab4d80c26bc40c8d42666d1a4bebe81099d4604d0506a4b71e542';
  const SCHEDULE = '2aabda53b9e018ef5c032e882b3c850fa4045931586d492add172a2db09f6f64';
  const INVENTORY = '52-MK-036668';
  const HASHED_ID = 'EKzJW7DK';
  const ADDRESS = {
    region: 'Kauno r. sav.', subDistrict: 'Garliavos apylinkių sen.', city: 'Juragių k.',
    street: 'Žalgirio g.', houseNumber: '8A', matchHouseNumber: true, pageIndex: 0,
  };

  // A session lasts 30 minutes; while one is live the page asks for no new one.
  const live = async () => (await page.context().cookies('https://grafikai.svara.lt'))
    .some(c => c.name === '__Host-gs_exp' && Number(c.value) * 1000 > Date.now() + 60000);
  if (!(await live())) {
    const session = page.waitForResponse(r => r.url().includes('/api/session') && r.ok(),
                                         { timeout: 180000 });
    await page.goto('https://grafikai.svara.lt/');
    await session;
  } else if (!page.url().startsWith('https://grafikai.svara.lt')) {
    await page.goto('https://grafikai.svara.lt/');
  }

  return await page.evaluate(async ([contractsId, scheduleId, address, inventory, hashedId]) => {
    const value = v => typeof v === 'string' ? { t: 1, s: v }
      : typeof v === 'boolean' ? { t: 2, s: v ? 2 : 3 } : { t: 0, s: v };
    const call = async (id, args) => {
      const payload = { t: { t: 10, i: 0, p: { k: ['data'], v: [{ t: 10, i: 1,
        p: { k: Object.keys(args), v: Object.values(args).map(value) }, o: 0 }] }, o: 0 },
        f: 63, m: [] };
      const res = await fetch(`/_serverFn/${id}?payload=` +
        encodeURIComponent(JSON.stringify(payload)),
        { headers: { 'x-tsr-serverFn': 'true', accept: 'application/json' } });
      if (!res.ok) throw new Error(`HTTP ${res.status} from server function ${id.slice(0, 8)}`);
      return res.text();
    };
    // seroval strings are {"t":1,"s":"..."}; pull them out by key position.
    const strings = text => [...text.matchAll(/\{"t":1,"s":"((?:[^"\\]|\\.)*)"\}/g)]
      .map(m => JSON.parse(`"${m[1]}"`));

    // Every contracts field is a Contains match, so read the address back.
    const contracts = strings(await call(contractsId, address));
    const fullAddress = contracts.find(s => s.startsWith('Žalgirio g. 8A,'));
    if (!contracts.includes(inventory) || !fullAddress?.includes('Juragių k.')) {
      throw new Error(`contracts did not return ${inventory} at Žalgirio g. 8A, Juragių k.`);
    }
    // The schedule is asked for by hashedId; make sure it still belongs to this bin.
    if (!contracts.includes(hashedId)) {
      throw new Error(`contracts no longer carry hashedId ${hashedId} for ${inventory}`);
    }
    const dates = strings(await call(scheduleId, { hashedId }))
      .filter(s => /^\d{4}-\d{2}-\d{2}$/.test(s));
    if (!dates.length) throw new Error('schedule returned no dates');
    const d = new Date();
    const checked = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-` +
      String(d.getDate()).padStart(2, '0');
    return { checked, inventory, hashedId, fullAddress,
             dates: [...new Set(dates)].sort() };
  }, [CONTRACTS, SCHEDULE, ADDRESS, INVENTORY, HASHED_ID]);
}
