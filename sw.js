/* Ruinexpose service worker — network-first, never cache post pages or APIs.
   Prevents deleted posts from resurrecting via stale offline shells. */
self.addEventListener('install', function (event) {
  self.skipWaiting();
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    (async function () {
      try {
        var keys = await caches.keys();
        await Promise.all(keys.map(function (k) { return caches.delete(k); }));
      } catch (e) {}
      await self.clients.claim();
    })()
  );
});

function shouldBypass(url) {
  try {
    var u = new URL(url);
    if (u.origin !== self.location.origin) return true;
    var p = u.pathname || '/';
    if (/^\/(?:post|p)\//i.test(p)) return true;
    if (/^\/api\//i.test(p)) return true;
    if (p === '/sitemap.xml' || p === '/robots.txt') return true;
    if (u.searchParams.has('p') || u.searchParams.has('post')) return true;
    return false;
  } catch (e) {
    return true;
  }
}

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return;
  if (shouldBypass(req.url)) {
    event.respondWith(fetch(req, { cache: 'no-store' }).catch(function () { return Response.error(); }));
    return;
  }
  // Default: network only — do not put HTML/app shells in Cache Storage.
  event.respondWith(fetch(req).catch(function () { return fetch(req, { cache: 'reload' }); }));
});
