#!/usr/bin/env node
/**
 * Deleted-post hard-gone: 410 responses, no OG leak, client purge, sitemap TTL.
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

var html = read('index.html');
var og = read('api/og.js');
var del = read('api/delete-post.js');
var mw = read('middleware.js');
var sm = read('api/sitemap.js');
var sw = read('sw.js');
var vercel = JSON.parse(read('vercel.json'));

assert(og.indexOf('This post is no longer available') >= 0, 'OG gone copy');
assert(og.indexOf('function gonePage') >= 0, 'OG gonePage helper');
assert(/if\s*\(\s*!post\s*\)[\s\S]{0,200}statusCode\s*=\s*410/.test(og), 'OG returns 410 when missing');
assert(og.indexOf('noimageindex') >= 0, 'OG X-Robots noimageindex for gone');
assert(!/if\s*\(\s*!post\s*\)[\s\S]{0,400}location\.replace/.test(og), 'gone page does not SPA-redirect');

assert(mw.indexOf('status: 410') >= 0 || mw.indexOf('status:410') >= 0, 'middleware 410 for deleted permalinks');
assert(mw.indexOf('This post is no longer available') >= 0, 'middleware gone HTML');
assert(mw.indexOf('postExists') >= 0, 'middleware existence check');
assert(mw.indexOf('async function middleware') >= 0 || mw.indexOf('export default async function middleware') >= 0, 'middleware is async');

assert(del.indexOf('purgeDeletedPostCaches') >= 0, 'delete-post CDN purge helper');
assert(del.indexOf('removalUrl') >= 0, 'delete-post returns GSC removal URL');
assert(del.indexOf('gscHint') >= 0, 'delete-post GSC hint');

assert(html.indexOf('function showPostGone') >= 0, 'client showPostGone');
assert(html.indexOf('function purgePostEverywhere') >= 0, 'client purgePostEverywhere');
assert(html.indexOf('Post successfully deleted') >= 0, 'success toast copy');
assert(html.indexOf("showPostGone(id)") >= 0, 'openDetail uses gone state');
assert(html.indexOf('rs_deleted_broadcast') >= 0, 'cross-tab delete broadcast');
assert(html.indexOf('BroadcastChannel') >= 0, 'BroadcastChannel delete bus');

assert(sm.indexOf('s-maxage=120') >= 0, 'sitemap short CDN TTL');
assert(sw.indexOf('clients.claim') >= 0, 'SW no-op claims clients');
assert(sw.indexOf('caches.delete') >= 0 || sw.indexOf('caches.delete(k)') >= 0, 'SW clears Cache Storage');
assert(!/addEventListener\(\s*['"]fetch['"]/.test(sw), 'SW must not intercept fetch (blank-page bug)');
assert(!/registration\.unregister/.test(sw), 'SW does not self-unregister (in-place replace)');
assert(html.indexOf('getRegistrations') >= 0, 'client finds sticky SWs');
assert(html.indexOf("register('/sw.js?v=") < 0, 'client must not register query-string SW');
assert(/reg\.update|r\.update/.test(html), 'client calls registration.update()');

var postHdr = (vercel.headers || []).find(function (h) {
  return h.source === '/post/:id';
});
assert(!!postHdr, 'vercel no-store headers for /post/:id');
assert(
  (postHdr.headers || []).some(function (x) {
    return /no-store/i.test(x.value || '');
  }),
  '/post/:id Cache-Control no-store'
);
var swHdr = (vercel.headers || []).find(function (h) {
  return h.source === '/sw.js';
});
assert(!!swHdr, 'vercel headers for /sw.js');
assert(
  (swHdr.headers || []).some(function (x) {
    return /no-store|no-cache/i.test(x.value || '');
  }),
  '/sw.js Cache-Control no-cache so no-op propagates'
);

// Must not mass-delete or touch unrelated systems in these files.
assert(
  /\.delete\(\)\.eq\(\s*['"]id['"]\s*,\s*(postId|variants)/.test(del) ||
    del.indexOf(".delete().eq('id', variants[i])") >= 0 ||
    del.indexOf('.delete().eq("id", variants[i])') >= 0 ||
    del.indexOf(".delete().eq('id', postId)") >= 0,
  'delete still targets single post id'
);
assert(html.indexOf('function openExtend') >= 0, 'Extend system kept');
assert(html.indexOf('function openGoonTok') >= 0, 'GoonTok kept');

console.log('OK · deleted-post-gone');
