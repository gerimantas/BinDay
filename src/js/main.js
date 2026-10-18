/* Startup only: first paint, the minute tick, refresh on return to the app, and the
   service worker. */
refresh();
setInterval(refresh, 60000);

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) refresh();
});

registerServiceWorker();
