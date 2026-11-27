/* Ruinexpose service worker — permanent no-op + safe client recovery.
   DO NOT add a fetch handler. DO NOT unregister from inside the worker.
   A prior SW intercepted every GET (including navigations). Hung/blank
   fetch handlers left Safari/Chrome on white/black screens while Incognito
   worked. This worker replaces that script URL in-place and claims clients.

   CRITICAL: never force-navigate controlled clients from activate. On iPhone
   Safari a mid-session navigation while the SPA is already painted leaves the
   tab with a stuck progress bar and dead taps (profile visible, bottom nav
   frozen). The page recovers via postMessage → oneReload() only when needed. */
self.addEventListener('install', function (event) {
  self.skipWaiting();
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    (async function () {
      try {
        var keys = await caches.keys();
        await Promise.all(
          keys.map(function (k) {
            return caches.delete(k);
          })
        );
      } catch (e) {}
      try {
        await self.clients.claim();
      } catch (e) {}
      try {
        var clients = await self.clients.matchAll({
          type: 'window',
          includeUncontrolled: true
        });
        clients.forEach(function (client) {
          try {
            if (client && typeof client.postMessage === 'function') {
              client.postMessage({ type: 'RS_SW_NOOP_READY', v: 4 });
            }
          } catch (e) {}
        });
      } catch (e) {}
    })()
  );
});

/* Intentionally no fetch handler — requests pass through to the network. */
