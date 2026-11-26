/* Ruinexpose service worker — permanent no-op + forced client recovery.
   DO NOT add a fetch handler. DO NOT unregister from inside the worker.
   A prior SW intercepted every GET (including navigations). Hung/blank
   fetch handlers left normal Safari/Chrome on white/black screens while
   Incognito worked. This worker replaces that script URL in-place, claims
   clients, then navigates them so a blank synthetic document is abandoned. */
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
              client.postMessage({ type: 'RS_SW_NOOP_READY', v: 3 });
            }
          } catch (e) {}
          // Force a real network navigation so a blank SW document is replaced.
          // Safe: we have no fetch handler, so navigate hits the network.
          try {
            if (client && typeof client.navigate === 'function' && client.url) {
              client.navigate(client.url);
            }
          } catch (e2) {}
        });
      } catch (e) {}
    })()
  );
});

/* Intentionally no fetch handler — requests pass through to the network. */
