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
/* When the operators were last asked for the schedule currently on screen.

   This is per-address, not per-build: the shipped Juragiai schedule was
   collected on the date below, while a picked address carries the date its own
   area's data was fetched. Showing a build date instead would claim freshness
   the data does not have — rebuilding from unchanged raw/ makes nothing newer.

   Kept as a `let` set through setCollected() for the same reason CONTAINERS
   became getSchedule(): a value that changes with the active address must not
   be a binding other modules captured at load time. */
const DEFAULT_COLLECTED = '2026-08-02';
let collected = DEFAULT_COLLECTED;

function getCollected() {
  return collected;
}

function setCollected(date) {
  collected = date || DEFAULT_COLLECTED;
}

/* The schedule shipped with the app — the default shown when no saved address is
   active. Treat as immutable: it is the fallback applyActive() returns to. */
const DEFAULT_SCHEDULE = [
  {
    type: 'MIXED', label: 'Mišrios', id: '52-MK-036668',
    // Calendar clients won't honour a colour we set, so the emoji carries the
    // colour coding instead. Chosen to match the app's neon palette.
    emoji: '🔴', color: 'red',
    operator: 'UAB Kauno švara', until: '2027-07-20',
    dates: ['2026-08-04','2026-08-18','2026-09-01','2026-09-15','2026-09-29',
            '2026-10-13','2026-10-27','2026-11-10','2026-11-24','2026-12-08',
            '2026-12-22','2027-01-05','2027-01-19','2027-02-02','2027-02-16',
            '2027-03-02','2027-03-16','2027-03-30','2027-04-13','2027-04-27',
            '2027-05-11','2027-05-25','2027-06-08','2027-06-22','2027-07-06',
            '2027-07-20']
  },
  {
    type: 'PACKAGING', label: 'Pakuotės', id: '52-P-22781',
    emoji: '🟡', color: 'gold',
    operator: 'Ekonovus', until: '2027-03-23',
    dates: ['2026-08-04','2026-08-25','2026-09-15','2026-10-06','2026-10-27',
            '2026-11-17','2026-12-08','2026-12-29','2027-01-19','2027-02-09',
            '2027-03-02','2027-03-23']
  },
  {
    type: 'GLASS', label: 'Stiklas', id: '52-S-24716',
    emoji: '🟢', color: 'springgreen',
    operator: 'Ekonovus', until: '2027-07-06',
    dates: ['2026-08-04','2026-10-27','2027-01-19','2027-04-13','2027-07-06']
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

/* Pass no argument (or an empty list) to fall back to the shipped schedule. The
   caller does not have to know what the default is. */
function setActiveSchedule(list) {
  activeSchedule = (list && list.length) ? list : DEFAULT_SCHEDULE;
}

const WD = ['Sekmadienis','Pirmadienis','Antradienis','Trečiadienis',
            'Ketvirtadienis','Penktadienis','Šeštadienis'];
const WD_SHORT = ['Sekm','Pir','Ant','Tre','Ket','Pen','Šeš'];
const MON_GEN = ['sausio','vasario','kovo','balandžio','gegužės','birželio',
                 'liepos','rugpjūčio','rugsėjo','spalio','lapkričio','gruodžio'];
