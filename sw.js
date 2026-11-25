/* Ruinexpose service worker — kill-switch.
   Previous builds intercepted every GET (including cross-origin CDNs and the
   ~2MB index.html). That left normal browser sessions blank/black while
   Incognito (no SW) still worked.

   This script replaces any controlling SW (skipWaiting + clients.claim),
   clears Cache Storage, notifies open tabs, then unregisters itself.
   No fetch handler and no client.navigate() — claiming without a fetch
   listener lets the next navigation hit the network; tabs that can hear
   postMessage reload once via sessionStorage. */
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
              client.postMessage({ type: 'RS_SW_KILLED' });
            }
          } catch (e) {}
        });
      } catch (e) {}
      try {
        await self.registration.unregister();
      } catch (e) {}
    })()
  );
});

/* Intentionally no fetch handler — do not intercept navigations or assets. */
