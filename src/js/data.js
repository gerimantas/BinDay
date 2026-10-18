/* ------------------------------------------------------------------
   Schedule data — generated from Atlieku_isvezimo_grafikai.md

   Dates are stored as an explicit list rather than anchor+interval on
   purpose: Švara's schedule does deviate (the window before 2026-08
   contained Monday pickups and an extra Wednesday run on 2026-07-22).
   Computing dates from a fixed interval would silently skip those, and
   a missed pickup is the one failure the user actually notices.

   `until` is the operator's published horizon, not a guess. Past it the
   app says "refresh needed" instead of inventing dates.
------------------------------------------------------------------ */
const ADDRESS = 'Žalgirio g. 8A, Juragių k., Garliavos apylinkių sen. Kauno r. sav.';
/* The address whose schedule is on screen, written into each ICS event's
   LOCATION. ADDRESS stays the shipped default; this follows the saved address.

   Read through getActiveAddress() for the same reason as getSchedule(): a value
   that changes with the active address must not be a binding other modules
   captured at load time. */
let activeAddress = ADDRESS;

function getActiveAddress() {
  return activeAddress;
}

function setActiveAddress(address) {
  activeAddress = address || ADDRESS;
}

/* When the operators were last asked for the schedule currently on screen.

   This is per-address, not per-build: the shipped Juragiai schedule was
   collected on the date below, while a picked address carries the date its own
   area's data was fetched. Showing a build date instead would claim freshness
   the data does not have — rebuilding from unchanged raw/ makes nothing newer.

   Kept as a `let` set through setCollected() for the same reason CONTAINERS
   became getSchedule(): a value that changes with the active address must not
   be a binding other modules captured at load time. */
const DEFAULT_COLLECTED = '2026-10-12';
// Per operator: Ekonovus is checked by the monthly run, Švara by hand in a browser
// (its site blocks automated requests), so the two dates drift apart.
const DEFAULT_CHECKED_EKONOVUS = '2026-10-12';
const DEFAULT_CHECKED_SVARA = '2026-10-12';
let collected = DEFAULT_COLLECTED;

function getCollected() {
  return collected;
}

function setCollected(date) {
  collected = date || DEFAULT_COLLECTED;
}

function getLastChecked() {
  return { ekonovus: DEFAULT_CHECKED_EKONOVUS, svara: DEFAULT_CHECKED_SVARA };
}

/* The schedule shipped with the app — the default shown when no saved address is
   active. Treat as immutable: it is the fallback applyActive() returns to. */
const DEFAULT_SCHEDULE = [
  {
    type: 'MIXED', label: 'Mišrios', id: '52-MK-036668',
    // Calendar clients won't honour a colour we set, so the emoji carries the
    // colour coding instead. Chosen to match the app's neon palette.
    emoji: '🔴', color: 'red',
    operator: 'UAB Kauno švara', until: '2028-01-04',
    dates: ['2026-08-04','2026-08-18','2026-09-01','2026-09-15','2026-09-29',
            '2026-10-13','2026-10-27','2026-11-10','2026-11-24','2026-12-08',
            '2026-12-22','2027-01-05','2027-01-19','2027-02-02','2027-02-16',
            '2027-03-02','2027-03-16','2027-03-30','2027-04-13','2027-04-27',
            '2027-05-11','2027-05-25','2027-06-08','2027-06-22','2027-07-06',
            '2027-07-20','2027-08-03','2027-08-17','2027-08-31','2027-09-14',
            '2027-09-28','2027-10-12','2027-10-26','2027-11-09','2027-11-23',
            '2027-12-07','2027-12-21','2028-01-04']
  },
  {
    type: 'PACKAGING', label: 'Pakuotės', id: '52-P-22781',
    emoji: '🟡', color: 'gold',
    operator: 'Ekonovus', until: '2027-06-15',
    dates: ['2026-08-04','2026-08-25','2026-09-15','2026-10-06','2026-10-27',
            '2026-11-17','2026-12-08','2026-12-29','2027-01-19','2027-02-09',
            '2027-03-02','2027-03-23','2027-04-13','2027-05-04','2027-05-25',
            '2027-06-15']
  },
  {
    type: 'GLASS', label: 'Stiklas', id: '52-S-24716',
    emoji: '🟢', color: 'springgreen',
    operator: 'Ekonovus', until: '2027-09-28',
    dates: ['2026-08-04','2026-10-27','2027-01-19','2027-04-13','2027-07-06',
            '2027-09-28']
  }
];

/* The schedule currently on screen.

   This was previously a module-level `const CONTAINERS` that applyActive()
   mutated in place (`CONTAINERS.length = 0; CONTAINERS.push(...)`). That worked
   only by accident of everything sharing one script scope: split into modules,
   each importing CONTAINERS as a binding, and the mutation would stop
   propagating — the app would keep rendering the built-in Juragiai schedule
   while displaying another address. Read through getSchedule(), replace through
   setActiveSchedule(), so the indirection survives the split. */
let activeSchedule = DEFAULT_SCHEDULE;

function getSchedule() {
  return activeSchedule;
}

function isMonitoredSchedule() {
  const ids = new Set(activeSchedule.map(container => container.id));
  return ['52-MK-036668', '52-P-22781', '52-S-24716'].every(id => ids.has(id));
}

/* Pass no argument (or an empty list) to fall back to the shipped schedule. The
   caller does not have to know what the default is. */
function setActiveSchedule(list) {
  activeSchedule = (list && list.length) ? list : DEFAULT_SCHEDULE;
}

/* Containers of the active saved address that have no published dates.

   applyActive() only records them here; render() is the one place that draws
   #app, so the notice survives the 60 s re-render. `none` means no container at
   the address has dates — render() then shows only the notice, never the shipped
   Juragiai schedule under another address's name. */
let activeUndated = { containers: [], none: false };

function getUndated() {
  return activeUndated;
}

function setUndated(containers, none) {
  activeUndated = { containers: containers || [], none: !!none };
}

const WD = ['Sekmadienis','Pirmadienis','Antradienis','Trečiadienis',
            'Ketvirtadienis','Penktadienis','Šeštadienis'];
const WD_SHORT = ['Sekm','Pir','Ant','Tre','Ket','Pen','Šeš'];
const MON_GEN = ['sausio','vasario','kovo','balandžio','gegužės','birželio',
                 'liepos','rugpjūčio','rugsėjo','spalio','lapkričio','gruodžio'];
