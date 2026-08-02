$('tabAddr').addEventListener('click', () => showPage('addr'));
$('tabSet').addEventListener('click', () => showPage('set'));

/* The add form starts collapsed: with several addresses saved, an always-open form
   pushed the list the user came here to use off the screen. */
$('addToggle').addEventListener('click', async () => {
  const form = $('addForm');
  const opening = form.hidden;
  form.hidden = !opening;
  $('addToggle').textContent = opening ? '× Atšaukti' : '+ Pridėti adresą';
  if (opening && !$('areaMenu').children.length) await fillAreas();
  if (opening) $('q').focus();
});

async function fillDataInfo() {
  const el = $('dataInfo');
  try {
    const idx = await getIndex();
    const names = idx.shipped.map(a => a.municipality).join(', ');
    el.textContent = `Duomenys surinkti ${idx.generated}. Veikia: ${names}. `
      + `Kitos savivaldybės ruošiamos — jose kol kas veža tik vienas vežėjas, `
      + `tad grafikas būtų nepilnas.`;
  } catch (e) {
    el.textContent = 'Nepavyko įkelti informacijos.';
  }
}

$('icsAll').addEventListener('click', () => {
  const entries = buildCalendar().filter(e => e.iso >= isoLocal(new Date()));
  if (entries.length) downloadICS(entries);
});

$('gear').addEventListener('click', async () => {
  sheet.classList.add('open');
  showPage('addr');
  renderSaved();
});
$('close').addEventListener('click', () => sheet.classList.remove('open'));
$('locate').addEventListener('click', locate);
$('areaBtn').addEventListener('click', () => {
  const p = $('areaPicker');
  const open = p.classList.toggle('open');
  $('areaBtn').setAttribute('aria-expanded', open ? 'true' : 'false');
});
// Close the picker when tapping anywhere else, the way a native select behaves.
document.addEventListener('click', ev => {
  const p = $('areaPicker');
  if (p && !p.contains(ev.target)) {
    p.classList.remove('open');
    $('areaBtn').setAttribute('aria-expanded', 'false');
  }
});
$('q').addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(doSearch, 200);
});

refresh();
setInterval(refresh, 60000);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) refresh();
});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
