/* Whether the user has asked to see the whole horizon. Deliberately not persisted:
   the minute-tick re-render reads it, but a fresh open should start compact. */
let expanded = false;

function render(now) {
  const today = isoLocal(now);
  const calendar = buildCalendar();
  const upcoming = calendar.filter(e => e.iso >= today);
  const app = document.getElementById('app');

  if (!upcoming.length) {
    app.innerHTML = `
      <div class="hero">
        <div class="when">Grafikas pasibaigė</div>
        <div class="days" style="font-size:30px">Reikia atnaujinti</div>
        <div class="date">Paskutinė data: ${calendar.length ? calendar[calendar.length - 1].iso : '—'}</div>
      </div>
      <footer>Perscrapink operatorių svetaines ir pergeneruok grafiką.</footer>`;
    return;
  }

  const next = upcoming[0];
  const days = daysBetween(today, next.iso);
  const nextDate = parseISO(next.iso);

  // "Tonight" is the actionable state: the operator asks for bins out the evening
  // before, so a pickup tomorrow is what needs acting on right now.
  const tonight = days === 1 || (days === 0 && now.getHours() < 8);

  /* The kicker says what to DO, not what the card is. "Kitas išvežimas" only
     restated the obvious — the big number below it already says a pickup is
     coming — so the line that actually matters lives here instead: the
     operators want the bins out the evening before. The two urgent states keep
     their own wording, which is more specific still. */
  let headline, when;
  if (days === 0) { headline = 'Šiandien'; when = 'Išveža'; }
  else if (days === 1) { headline = 'Rytoj'; when = 'Išstumk šįvakar'; }
  else { headline = `Po ${days} d.`; when = 'Konteinerius paruošti iš vakaro'; }

  /* Chips share a fixed width, so a short name would sit in a pool of empty box.
     Tracking is widened in two steps according to how many characters the name is
     short of the longest one in play — computed from the actual labels rather than
     hardcoded, since a new waste type changes which name is longest. */
  const widest = Math.max(...getSchedule().map(c => c.label.length), 1);
  const track = label => {
    const gap = widest - label.length;
    return gap >= 3 ? ' t2' : gap >= 1 ? ' t1' : '';
  };

  const chips = types => types
    .map(c => `<span class="chip ${c.type}${track(c.label)}">${c.label}</span>`)
    .join('');

  // Outlined labels in the bin's own colour. The name carries the meaning, so the dot
  // is redundant beside it — the border supplies the colour cue on its own.
  const dots = types => types
    .map(c => `<span class="mark ${c.type}${track(c.label)}">${c.label}</span>`)
    .join('');

  let html = `
    <div class="hero${tonight ? ' tonight' : ''}">
      <div class="when">${when}</div>
      <div class="days">${headline}</div>
      <div class="date">${WD[nextDate.getDay()]}, ${prettyDate(next.iso)}</div>
      <div class="types">${chips(next.types)}</div>
    </div>`;

  // Show a season's worth by default — enough to plan around without a wall of
  // dates — and keep the rest one tap away rather than dropping it. The full list
  // runs to the operator's horizon, which is where "no more data" genuinely starts.
  const PREVIEW = 8;
  const rest = expanded ? upcoming.slice(1) : upcoming.slice(1, PREVIEW + 1);
  const hidden = upcoming.length - 1 - rest.length;

  if (rest.length) {
    html += '<h2>Toliau</h2>';
    let shownYear = parseISO(today).getFullYear();
    for (const e of rest) {
      const d = parseISO(e.iso);
      // Once the list runs past New Year, "13 sausio" is ambiguous without the year.
      // A divider costs one line and answers it for every row beneath it.
      if (d.getFullYear() !== shownYear) {
        shownYear = d.getFullYear();
        html += `<div class="year-sep">${shownYear}</div>`;
      }
      const rel = relativeLabel(daysBetween(today, e.iso));
      html += `
        <div class="row">
          <div class="left">
            <div class="d">${prettyDate(e.iso)}</div>
            <div class="wd">${WD_SHORT[d.getDay()]}${rel ? ` · ${rel}` : ''}</div>
          </div>
          <div class="marks">${dots(e.types)}</div>
        </div>`;
    }

    if (hidden > 0) {
      html += `<button id="more" class="more">Rodyti visus (dar ${hidden})</button>`;
    } else if (expanded) {
      html += '<button id="less" class="more">Rodyti mažiau</button>';
    }
  }

  html += `
    <div class="actions">
      <button id="ics">
        Įkelti į kalendorių
        <span class="sub">${upcoming.length} įvykiai · priminimai 17:00 ir 20:00 iš vakaro</span>
      </button>
    </div>`;

  // Surface each container's horizon: they differ (Ekonovus publishes a fixed
  // count, Švara a rolling window), so one running out is normal and shouldn't
  // read as the whole schedule being stale.
  const expiring = getSchedule()
    .filter(c => daysBetween(today, c.until) < 60)
    .map(c => c.label);

  // "Konteinerius paruošti iš vakaro" moved into the hero, where it is the
  // instruction rather than a footnote. The footer keeps only provenance.
  html += `<footer>
    Duomenys surinkti ${getCollected()}
    ${expiring.length ? `<br><span class="warn">Baigiasi grafikas: ${expiring.join(', ')}</span>` : ''}
  </footer>`;

  app.innerHTML = html;
  document.getElementById('ics').addEventListener('click', () => downloadICS(upcoming));

  const more = document.getElementById('more');
  if (more) more.addEventListener('click', () => { expanded = true; refresh(); });
  const less = document.getElementById('less');
  if (less) less.addEventListener('click', () => { expanded = false; refresh(); });
}
