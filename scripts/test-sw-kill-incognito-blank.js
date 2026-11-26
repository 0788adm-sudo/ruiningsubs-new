#!/usr/bin/env node
/**
 * Static guards: blank/infinite-load outside Incognito must be fixed by an
 * in-place no-op at /sw.js — never by registering a query-string SW URL.
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

assert(/no-op|noop|NOOP/i.test(sw) || sw.indexOf('clients.claim') >= 0, 'sw.js is recovery no-op');
assert(sw.indexOf('skipWaiting') >= 0, 'sw.js skipWaiting for fast replace');
assert(sw.indexOf('clients.claim') >= 0, 'sw.js claims clients so buggy fetch handler is replaced');
assert(!/addEventListener\(\s*['"]fetch['"]/.test(sw), 'no fetch handler (must not intercept)');
assert(!/respondWith\s*\(/.test(sw), 'no respondWith()');
assert(!/registration\.unregister/.test(sw), 'SW must not self-unregister (page unregisters after update)');
assert(!/shouldBypass/.test(sw), 'old intercepting SW logic removed');

assert(html.indexOf("register('/sw.js?v=") < 0, 'must NOT register query-string SW URL (leaves buggy SW in control)');
assert(html.indexOf("register('/sw.js')") >= 0 || html.indexOf('register("/sw.js")') >= 0, 'register canonical /sw.js to force in-place update');
assert(/reg\.update|r\.update/.test(html), 'calls registration.update() on existing SWs');
assert(html.indexOf('RS_SW_NOOP_READY') >= 0, 'listens for no-op ready message');
assert(html.indexOf('controllerchange') >= 0, 'reloads once on controllerchange');
assert(html.indexOf('rs_sw_recovered_v3') >= 0, 'one-shot reload key prevents infinite loops');
assert(html.indexOf('__rsSwRecovered') >= 0, 'in-memory reload guard for Telegram (no sessionStorage)');
assert(html.indexOf('reloadArmed') >= 0, 'reloadArmed prevents multi-fire reload');
assert(!/if\s*\(\s*navigator\.serviceWorker\.controller\s*&&\s*!sessionStorage/.test(html), 'must not reload on every paint just because a controller exists');
assert(html.indexOf('Clear-Site-Data') < 0 || html.indexOf('"storage"') < 0, 'must not clear user storage via HTML');

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
assert(/no-store|no-cache/i.test(cc), '/sw.js must not be CDN-cached');

var idxHdr = (vercel.headers || []).find(function (h) {
  return h.source === '/index.html' || h.source === '/';
});
assert(!!idxHdr, 'vercel.json has HTML no-store headers');

console.log('OK · sw-kill-incognito-blank');
