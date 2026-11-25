/* Ruinexpose service worker — permanent no-op (Chrome/Workbox recovery pattern).
   DO NOT add a fetch handler. DO NOT unregister from inside the worker.
   A prior SW intercepted every GET (including navigations). Hung fetch handlers
   left normal browsers / Telegram WebViews on an infinite spinner while Incognito
   worked. Replacing that worker in-place at the SAME script URL (/sw.js) with this
   no-op lets clients.claim() take control without intercepting; the page then
   unregisters safely. Query-string registrations must never be used — they leave
   the buggy worker in control. */
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
              client.postMessage({ type: 'RS_SW_NOOP_READY' });
            }
          } catch (e) {}
        });
      } catch (e) {}
    })()
  );
});

/* Intentionally no fetch handler — requests pass through to the network. */
