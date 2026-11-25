#!/usr/bin/env node
/**
 * Regression: site blank outside Incognito was caused by a controlling SW
 * that intercepted every GET (HTML + cross-origin CDNs). Guard the kill-switch.
 */
'use strict';
var fs = require('fs');
var path = require('path');
var root = path.join(__dirname, '..');

function read(p) {
  return fs.readFileSync(path.join(root, p), 'utf8');
}
function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL · ' + msg);
    process.exit(1);
  }
  console.log('PASS · ' + msg);
}

var sw = read('sw.js');
var html = read('index.html');
var vercel = JSON.parse(read('vercel.json'));

assert(sw.indexOf('kill-switch') >= 0 || sw.indexOf('Kill') >= 0 || sw.indexOf('unregister') >= 0, 'sw.js is a kill-switch');
assert(sw.indexOf('skipWaiting') >= 0, 'sw.js skipWaiting for fast replace');
assert(sw.indexOf('unregister') >= 0, 'sw.js unregisters on activate');
assert(sw.indexOf('caches.keys') >= 0, 'sw.js clears caches');
assert(!/addEventListener\(\s*['"]fetch['"]/.test(sw), 'no fetch handler (must not intercept)');
assert(!/respondWith/.test(sw), 'no respondWith');
assert(!/shouldBypass/.test(sw), 'old intercepting SW logic removed');

assert(html.indexOf("serviceWorker.getRegistrations") >= 0, 'head unregisters existing SWs');
assert(html.indexOf('sw.js?v=kill-') >= 0 || html.indexOf("register('/sw.js") >= 0, 'registers kill-switch for update');
assert(html.indexOf('RS_SW_KILLED') >= 0, 'client listens for kill message / reload');
assert(
  /function setupPwaInstall\(\)\{[\s\S]{0,600}getRegistrations/.test(html),
  'setupPwaInstall unregisters instead of keeping SW'
);
assert(
  !/function setupPwaInstall\(\)\{[\s\S]{0,400}register\(\s*['"]\/sw\.js['"]\s*\)/.test(html),
  'setupPwaInstall no longer permanently registers /sw.js'
);

var swHdr = (vercel.headers || []).find(function (h) {
  return h.source === '/sw.js';
});
assert(!!swHdr, 'vercel.json has /sw.js headers');
var cc = (swHdr.headers || [])
  .filter(function (h) {
    return /cache-control/i.test(h.key || '');
  })
  .map(function (h) {
    return h.value || '';
  })
  .join(' ');
assert(/no-store|no-cache/i.test(cc), '/sw.js must not be CDN-cached for 4h');

console.log('OK · sw-kill-incognito-blank');
