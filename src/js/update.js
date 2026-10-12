/* ------------------------------------------------------------------
   Telling the user an update is ready.

   The worker is cache-first, so a new build used to land silently: the phone
   kept showing the old page until the app happened to be closed and reopened,
   and nothing said a newer schedule was waiting. Now the new worker installs,
   waits, and the page offers it; accepting reloads onto the new build. Same
   pattern as BakeStack. The offer stays on screen until answered — a toast that
   fades in three seconds is easy to miss on the one open that matters.

   An installed PWA can sit in the background for days without a fresh load, so
   the worker is also asked to look for an update whenever the app comes back
   to the foreground.
------------------------------------------------------------------ */
let updateTimer = null;

function showUpdate(message, action) {
  const el = document.getElementById('update');
  el.innerHTML = '';
  const span = document.createElement('span');
  span.textContent = message;
  el.appendChild(span);
  if (action) {
    const btn = document.createElement('button');
    btn.textContent = action.label;
    btn.addEventListener('click', action.run);
    el.appendChild(btn);
  }
  el.hidden = false;
  clearTimeout(updateTimer);
  // Information fades; an offer that needs an answer does not.
  if (!action) updateTimer = setTimeout(() => { el.hidden = true; }, 4000);
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;

  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(reg => {
    const offer = worker => showUpdate('Yra nauja programėlės versija.', {
      label: 'Atnaujinti',
      run: () => worker.postMessage('SKIP_WAITING'),
    });
    // Downloaded on an earlier visit and still waiting.
    if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const nw = reg.installing;
      if (!nw) return;
      nw.addEventListener('statechange', () => {
        // No controller means a first install: a cache fill, not an update.
        if (nw.state === 'installed' && navigator.serviceWorker.controller) offer(nw);
      });
    });
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) reg.update().catch(() => {});
    });
  }).catch(() => { /* offline support is optional; the app works without it */ });

  // The new worker took over: reload once so the page runs the build it cached.
  // Not on a first visit, where clients.claim() also fires this.
  const hadController = !!navigator.serviceWorker.controller;
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading || !hadController) return;
    reloading = true;
    location.reload();
  });
}
