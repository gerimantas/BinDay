/* ---- settings UI ---- */
const $ = id => document.getElementById(id);
const sheet = $('sheet');

function renderSaved() {
  const box = $('saved');
  if (!saved.list.length) {
    box.innerHTML = '<div class="hint" style="margin:0">Dar nieko neišsaugota. '
      + 'Rodomas numatytasis adresas.</div>';
    return;
  }
  box.innerHTML = '';
  saved.list.forEach((a, i) => {
    const row = document.createElement('div');
    row.className = 'row' + (i === saved.active ? ' active' : '');

    const tick = document.createElement('div');
    tick.className = 'tick';
    tick.textContent = i === saved.active ? '●' : '○';

    const name = document.createElement('div');
    name.className = 'name';
    /* Show the short form — the operator's full string repeats the seniūnija and
       savivaldybė the user just picked, and wraps to three lines on a phone. */
    name.appendChild(document.createTextNode(shortAddress(a.address)));
    const meta = document.createElement('span');
    meta.className = 'meta';
    for (const dot of typeDots(a.containers)) meta.appendChild(dot);
    const n = document.createElement('span');
    n.textContent = distinctTypes(a.containers)
      .map(t => (TYPE_META[t] || TYPE_META.OTHER).label).join(' · ');
    meta.appendChild(n);
    name.appendChild(meta);

    /* The container numbers are what the user checks against the sticker on the bin,
       so show them rather than only a count. */
    const ids = a.containers.map(c => c.id).filter(Boolean);
    if (ids.length) {
      const nums = document.createElement('span');
      nums.className = 'nums';
      nums.textContent = ids.join(' · ');
      name.appendChild(nums);
    }
    name.addEventListener('click', () => {
      saved.active = i; persist(saved); renderSaved(); applyActive();
    });
    row.appendChild(tick);
    const del = document.createElement('button');
    del.className = 'del'; del.textContent = 'Šalinti';
    del.addEventListener('click', ev => {
      ev.stopPropagation();
      saved.list.splice(i, 1);
      if (saved.active >= saved.list.length) saved.active = Math.max(0, saved.list.length - 1);
      persist(saved); renderSaved(); applyActive();
    });
    row.append(name, del);
    box.appendChild(row);
  });
}

let areaValue = '';   // '' none, 'Name' shipped, '!Name' pending

function setArea(value, label) {
  areaValue = value;
  $('areaVal').textContent = label;
  $('areaPicker').classList.remove('open');
  $('areaBtn').setAttribute('aria-expanded', 'false');
  $('busy').hidden = true;
  doSearch();
}

async function fillAreas() {
  const menu = $('areaMenu');
  let idx;
  try { idx = await getIndex(); }
  catch (e) { $('areaVal').textContent = 'Nepavyko įkelti sąrašo'; return; }
  menu.innerHTML = '';

  const addOption = (value, label, dim) => {
    const d = document.createElement('div');
    d.className = 'opt' + (dim ? ' dim' : '');
    d.setAttribute('role', 'option');
    d.textContent = label;
    d.addEventListener('click', () => setArea(value, label));
    menu.appendChild(d);
    return d;
  };

  for (const a of idx.shipped) addOption(a.municipality, a.municipality, false);

  if (idx.pending.length) {
    const g = document.createElement('div');
    g.className = 'grp';
    g.textContent = 'Ruošiama — duomenų dar nėra';
    menu.appendChild(g);
    for (const a of idx.pending) {
      addOption('!' + a.municipality, a.municipality, true);
    }
  }

  const first = idx.shipped[0];
  if (first) {
    areaValue = first.municipality;
    $('areaVal').textContent = first.municipality;
  }
}

function pendingNotice(name) {
  const box = $('suggest');
  box.innerHTML = '';
  const d = document.createElement('div');
  d.className = 'notice';
  d.textContent = name + ' — duomenys ruošiami. Šioje savivaldybėje veikia tik vienas '
    + 'vežėjas, tad grafikas būtų nepilnas: trūktų dalies konteinerių. Kol to nepataisysime, '
    + 'geriau nerodyti nieko, nei rodyti pusę.';
  box.appendChild(d);
}

let searchTimer = null;
async function doSearch() {
  const area = areaValue;
  const q = $('q').value.trim();
  const box = $('suggest');
  if (area.startsWith('!')) { pendingNotice(area.slice(1)); return; }
  if (q.length < 3) { box.innerHTML = ''; return; }

  const idx = await getIndex();
  const entry = idx.shipped.find(a => a.municipality === area);
  if (!entry) { box.innerHTML = ''; return; }

  box.innerHTML = '<div class="none">Ieškoma…</div>';
  let hits;
  try {
    hits = searchAddresses(await getArea(entry.files), q);
  } catch (e) {
    box.innerHTML = '<div class="none">Nepavyko įkelti duomenų.</div>';
    return;
  }
  box.innerHTML = '';
  if (!hits.length) {
    box.innerHTML = '<div class="none">Nieko nerasta. Pabandykite tik gatvės pavadinimą.</div>';
    return;
  }
  for (const h of hits) {
    const d = document.createElement('div');
    d.className = 'hit';
    const label = document.createElement('span');
    label.style.flex = '1';
    label.textContent = shortAddress(h.address);
    const dots = document.createElement('span');
    dots.className = 'dots';
    /* One dot per waste TYPE, not per container — a property with two mixed-waste bins
       showed two identical red dots, which reads as a data error rather than as
       "collected twice". */
    for (const dot of typeDots(h.containers)) dots.appendChild(dot);
    d.append(label, dots);
    d.addEventListener('click', () => addAddress(h));
    box.appendChild(d);
  }
}

function addAddress(hit) {
  if (saved.list.some(a => a.address === hit.address)) {
    saved.active = saved.list.findIndex(a => a.address === hit.address);
  } else {
    saved.list.push({
      address: hit.address,
      containers: hit.containers.map(c => ({ id: c.id, type: c.type,
                                             operator: c.operator, hashedId: c.hashedId }))
    });
    saved.active = saved.list.length - 1;
  }
  persist(saved);
  $('q').value = '';
  $('suggest').innerHTML = '';
  $('busy').hidden = true;
  // Collapse the form again so the list of saved addresses is what the user sees next.
  $('addForm').hidden = true;
  $('addToggle').textContent = '+ Pridėti adresą';
  renderSaved();
  applyActive();
}

/* Geolocation is a shortcut, never an answer. Reverse geocoding returns the
   nominative ("Jonučiai") while the operators store the genitive
   ("Jonučių k."), so an exact match finds nothing — we search on the street
   name and let the user confirm which address is theirs. */
async function locate() {
  const busy = $('busy');
  busy.hidden = false;
  busy.textContent = 'Nustatoma vieta…';
  if (!navigator.geolocation) { busy.textContent = 'Vietos nustatymas nepalaikomas.'; return; }
  navigator.geolocation.getCurrentPosition(async pos => {
    const { latitude: lat, longitude: lon } = pos.coords;
    busy.textContent = 'Ieškoma adreso…';
    try {
      const r = await fetch('https://nominatim.openstreetmap.org/reverse?format=json'
        + '&addressdetails=1&accept-language=lt&lat=' + lat + '&lon=' + lon);
      const g = await r.json();
      const a = g.address || {};
      const street = a.road || '';
      const place = a.village || a.town || a.city || a.hamlet || '';
      if (!street && !place) { busy.textContent = 'Adreso nustatyti nepavyko.'; return; }
      // Search on the street plus the house number when we have one; the locality
      // is only a hint because its grammatical case will not match.
      $('q').value = [street, a.house_number].filter(Boolean).join(' ');
      busy.textContent = 'Rasta: ' + [place, street, a.house_number].filter(Boolean).join(' ')
        + ' — pasirinkite savo adresą iš sąrašo.';
      await doSearch();
    } catch (e) {
      busy.textContent = 'Nepavyko pasiekti vietos paslaugos.';
    }
  }, err => {
    busy.textContent = err.code === err.PERMISSION_DENIED
      ? 'Vietos prieiga neleista.' : 'Vietos nustatyti nepavyko.';
  }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 });
}

/* Swap the rendered schedule to the active saved address.

   The catalogue holds containers, not dates — fetching dates in bulk is far
   too slow at the operators' end, so a saved address carries its schedule
   alongside it once fetched. Until that per-address schedule feed exists,
   an address selected here shows its containers and states plainly that the
   dates are still coming, rather than showing the built-in address's dates
   under someone else's street name. */
function applyActive() {
  const a = saved.list[saved.active];
  if (!a) {
    setActiveSchedule();          // back to the shipped Juragiai schedule
    document.getElementById('addr').textContent = 'Žalgirio g. 8A, Juragiai';
    refresh();
    return;
  }
  document.getElementById('addr').textContent = shortAddress(a.address);
  if (a.schedule && a.schedule.length) {
    setActiveSchedule(a.schedule);
    refresh();
    return;
  }
  /* No dates for this address yet — make sure a previously selected address's
     schedule is not left on screen under this one's name. */
  setActiveSchedule();
  const types = a.containers
    .map(c => (TYPE_META[c.type] || TYPE_META.OTHER))
    .map(m => m.emoji + ' ' + m.label).join(' · ');
  document.getElementById('app').innerHTML =
    '<div class="notice">Rasti konteineriai: ' + types
    + '<br><br>Išvežimo datos šiam adresui dar neįkeltos — ruošiame. '
    + 'Konteinerių numeriai: '
    + a.containers.map(c => c.id).join(', ') + '</div>';
}

function showPage(which) {
  const addr = which === 'addr';
  $('pageAddr').classList.toggle('on', addr);
  $('pageSet').classList.toggle('on', !addr);
  $('tabAddr').classList.toggle('on', addr);
  $('tabSet').classList.toggle('on', !addr);
  $('tabAddr').setAttribute('aria-selected', addr ? 'true' : 'false');
  $('tabSet').setAttribute('aria-selected', addr ? 'false' : 'true');
  if (!addr) fillDataInfo();
}
