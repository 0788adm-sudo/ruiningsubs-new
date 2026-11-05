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
assert(html.includes('function copySectionLink'), 'copySectionLink helper');
assert(html.includes('function sectionShareUrl'), 'sectionShareUrl helper');
assert(html.includes('function detailGalleryStep'), 'detail gallery step');
assert(html.includes('dx-thumbs') && html.includes('detailGalleryStep(-1)'), 'gallery arrows + thumbs');
assert(html.includes('hydratePinnedPost(post)'), 'detail hydrates pinned posts');
assert(/postHasActiveTimer[\s\S]{0,220}60\*24\*3600\*1000/.test(html), 'active timer excludes far-future');

var sources = (vercel.rewrites || []).map(function (r) { return r.source; });
['/extend', '/wall', '/goontok', '/explore', '/spotlight'].forEach(function (s) {
  assert(sources.indexOf(s) >= 0, 'vercel rewrite ' + s);
});

console.log('\nSection routes + gallery checks passed');
