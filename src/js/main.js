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
    const names = idx.areas.map(a => a.municipality).join(', ');
    const total = idx.areas.reduce((n, a) => n + (a.addresses || 0), 0);
    el.textContent = `Duomenys surinkti ${idx.generated}. Veikia: ${names} `
      + `(${total.toLocaleString('lt-LT')} adresų). `
      + `Kitos savivaldybės dar neįkeltos.`;
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

/* Restore the active saved address before the first paint. Without this the app
   opens on the built-in Juragiai schedule and only switches once the user opens
   the menu — invisible until dates existed, and exactly the "right dates under
   the wrong address" failure the schedule accessors were introduced to prevent.
   applyActive() falls back to the shipped schedule when nothing is saved. */
applyActive();
setInterval(refresh, 60000);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) refresh();
});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
