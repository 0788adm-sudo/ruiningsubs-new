#!/usr/bin/env node
'use strict';
var fs = require('fs');
var path = require('path');
var root = path.join(__dirname, '..');
var html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
var vercel = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    process.exit(1);
  }
  console.log('PASS ·', msg);
}

assert(html.includes("PANEL_ROUTE") && /'feed':'extend'/.test(html), 'Extend panel maps to /extend');
assert(html.includes("'spotlight':'feed'"), 'spotlight route opens feed');
assert(html.includes("'challenges':'games'"), 'games hub route');
assert(html.includes("'community':'c'"), 'community route');
assert(html.includes("'lockmonth':'caged50'"), 'caged50 route');
assert(html.includes("'video-post':'upload-video'"), 'upload-video route');
assert(html.includes("'user':'u'"), 'user profile route');
assert(html.includes('function copySectionLink'), 'copySectionLink helper');
assert(html.includes('function sectionShareUrl'), 'sectionShareUrl helper');
assert(html.includes('history.pushState'), 'pushState for back/forward');
assert(html.includes('function detailGalleryStep'), 'detail gallery step');
assert(html.includes('dx-thumbs') && html.includes('detailGalleryStep(-1)'), 'gallery arrows + thumbs');
assert(html.includes('hydratePinnedPost(post)'), 'detail hydrates pinned posts');
assert(/postHasActiveTimer[\s\S]{0,220}60\*24\*3600\*1000/.test(html), 'active timer excludes far-future');

// GoonTok stability
assert(html.includes('preservePlay'), 'GoonTok preservePlay bind option');
assert(html.includes('__gtSoftCooldown'), 'soft-fail remount cooldown');
assert(html.includes('renderGoonTok({quiet:true})') || html.includes('renderGoonTok({quiet'), 'quiet GoonTok refresh');
assert(!/if\(v\.readyState===0\)\{\s*failVideo\(v,'warm_timeout'\)/.test(html), 'no warm_timeout drop on readyState 0');
assert(html.includes('Do NOT clear the fetch lock') || html.includes('Do NOT clear the fetch lock'), '18s poll keeps fetch lock');

var sources = (vercel.rewrites || []).map(function (r) { return r.source; });
[
  '/extend', '/wall', '/goontok', '/explore', '/spotlight', '/print', '/games',
  '/alerts', '/new', '/idcard', '/pea', '/tasks', '/doms', '/login', '/caged50',
  '/upload-video', '/c/:id', '/u/:username', '/messages', '/profile', '/coins',
  '/roulette', '/dice', '/map', '/randomcam', '/videos'
].forEach(function (s) {
  assert(sources.indexOf(s) >= 0, 'vercel rewrite ' + s);
});

console.log('\nSection routes + gallery + GoonTok stability checks passed');
