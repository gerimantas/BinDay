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
/* When the operators were last asked for the schedule. Not read by the app:
   tools/update_zalgirio_schedule.py rewrites this line, so it stays as the
   record of the last data change. */
const DEFAULT_COLLECTED = '2026-10-12';
// Per operator: Ekonovus is checked by the monthly run, Švara by hand in a browser
// (its site blocks automated requests), so the two dates drift apart.
const DEFAULT_CHECKED_EKONOVUS = '2026-10-12';
const DEFAULT_CHECKED_SVARA = '2026-10-12';
function getLastChecked() {
  return { ekonovus: DEFAULT_CHECKED_EKONOVUS, svara: DEFAULT_CHECKED_SVARA };
}

/* The schedule shipped with the app. Treat as immutable. */
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

/* Read through getSchedule() rather than the constant so the rest of the app
   never depends on where the schedule comes from. */
function getSchedule() {
  return DEFAULT_SCHEDULE;
}

const WD = ['Sekmadienis','Pirmadienis','Antradienis','Trečiadienis',
            'Ketvirtadienis','Penktadienis','Šeštadienis'];
const WD_SHORT = ['Sekm','Pir','Ant','Tre','Ket','Pen','Šeš'];
const MON_GEN = ['sausio','vasario','kovo','balandžio','gegužės','birželio',
                 'liepos','rugpjūčio','rugsėjo','spalio','lapkričio','gruodžio'];
