#!/usr/bin/env node
/**
 * Admin thumbs + permanent request cleanup — static + helper unit checks.
 */
'use strict';
var fs = require('fs');
var path = require('path');
var vm = require('vm');
var root = path.join(__dirname, '..');
var html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL · ' + msg);
    process.exit(1);
  }
  console.log('PASS · ' + msg);
}

assert(html.indexOf('function normalizeAdminPostId') >= 0, 'normalizeAdminPostId helper');
assert(html.indexOf('function adminFirstImageFromRow') >= 0, 'adminFirstImageFromRow helper');
assert(html.indexOf('function batchFetchAdminThumbs') >= 0, 'batchFetchAdminThumbs');
assert(html.indexOf('function dedupeAdminRequests') >= 0, 'dedupeAdminRequests');
assert(html.indexOf('function permanentlyDeleteAdminRequests') >= 0, 'permanent delete');
assert(html.indexOf('purgeSelectedAdminRequests') >= 0, 'multi-select purge');
assert(html.indexOf('purgeOldAdminRequests') >= 0, 'purge >7d');
assert(html.indexOf("select('id,image_url,username,title,created_at,tags')") >= 0, 'SB select avoids media_url/thumb_url');
assert(!/from\('posts'\)\.select\([^)]*media_url/.test(html), 'no posts select with media_url');
assert(html.indexOf('encodeAdminItem') >= 0 && html.indexOf('decodeAdminItem') >= 0, 'safe checkbox payload encode');
assert(html.indexOf('posts stay online') >= 0, 'confirm copy protects posts');
assert(html.indexOf('Request records do not own post media') >= 0, 'never delete post media on purge');
assert(html.indexOf('Pin requests') >= 0 && html.indexOf('Delete requests') >= 0, 'section headers');
assert(html.indexOf('#panel-admin #admin-body{padding-bottom:calc(96px') >= 0, 'bottom nav padding');
assert(html.indexOf('admin-req-check') >= 0, 'multi-select checkboxes');
assert(html.indexOf("onclick=\"openDetail(") >= 0, 'Open / thumb openDetail wiring');

// Extract + unit-test pure helpers in a sandbox.
var start = html.indexOf('function normalizeAdminPostId');
var mid = html.indexOf('function adminThumbHtml');
var dedupeStart = html.indexOf('function dedupeAdminRequests');
var dedupeEnd = html.indexOf('async function permanentlyDeleteAdminRequests');
assert(start > 0 && mid > start && dedupeStart > 0 && dedupeEnd > dedupeStart, 'helper block bounds');
var chunk = html.slice(start, mid) + '\n' + html.slice(dedupeStart, dedupeEnd);

var sandbox = { console: console, Math: Math, Date: Date, Array: Array, Object: Object, String: String, Number: Number, JSON: JSON, isFinite: isFinite, parseInt: parseInt, RegExp: RegExp };
vm.createContext(sandbox);
vm.runInContext(chunk + '\nthis.normalizeAdminPostId=normalizeAdminPostId;this.adminFirstImageFromRow=adminFirstImageFromRow;this.dedupeAdminRequests=dedupeAdminRequests;', sandbox);

assert(sandbox.normalizeAdminPostId(2762.0) === '2762', 'normalize float number');
assert(sandbox.normalizeAdminPostId('2762.0') === '2762', 'normalize float string');
assert(sandbox.normalizeAdminPostId('post #2440') === '2440', 'normalize message id');
assert(sandbox.normalizeAdminPostId('') === '', 'normalize empty');

var img = sandbox.adminFirstImageFromRow({
  image_url: JSON.stringify(['https://cdn.example/a.jpg', 'https://cdn.example/b.jpg']),
  tags: []
});
assert(img === 'https://cdn.example/a.jpg', 'first image from image_url array');

var img2 = sandbox.adminFirstImageFromRow({
  images: ['https://cdn.example/first.webp'],
  image_url: '["https://cdn.example/second.webp"]'
});
assert(img2 === 'https://cdn.example/first.webp', 'prefer images[] first');

var deduped = sandbox.dedupeAdminRequests([
  { id: '2762.0', at: 1, title: 'a' },
  { id: 2762, at: 9, title: 'b' },
  { id: '2762', at: 5, title: 'c' }
]);
assert(deduped.length === 1, 'dedupe float/string post ids');
assert(String(deduped[0].id) === '2762', 'dedupe keeps normalized id');
assert(deduped[0].at === 9, 'dedupe keeps newer copy');

console.log('\nAdmin thumbs/cleanup checks passed');
