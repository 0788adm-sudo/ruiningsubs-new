#!/usr/bin/env node
'use strict';
var fs = require('fs');
var path = require('path');
var html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
function assert(c, m) {
  if (!c) {
    console.error('FAIL:', m);
    process.exit(1);
  }
  console.log('PASS ·', m);
}

// 1) Video thumb must never be packed into image_url album
assert(html.includes('must never be packed into the media album'), 'createCfPost no longer packs thumb into image_url');
assert(!/imageField=JSON\.stringify\(\[imageField,row\.thumb_url\]\)/.test(html), 'legacy thumb pack removed');
assert(html.includes('function splitVideoAndPoster'), 'splitVideoAndPoster helper');
assert(html.includes('function sanitizeVideoPostMedia'), 'sanitizeVideoPostMedia helper');
assert(html.includes('Video posts: only the original clip in the gallery'), 'openDetail strips thumb from gallery');

// 2) Videos are permanent — no timer on publish / UI
assert(/expires_at:\s*null/.test(html) && html.includes('Videos are permanent'), 'publishVideoPost sets expires_at null');
assert(html.includes('Videos are permanent on GoonTok — never show Extend'), 'goontokTimed always false');
assert(/function postHasActiveTimer\(p\)\{[\s\S]{0,400}isVideoPost/.test(html), 'postHasActiveTimer excludes videos');
assert(html.includes('Permanent on GoonTok — no timer'), 'composer copy says permanent');

// 3) Exactly five Wall tabs
var chips = html.match(/data-wall-filter="[^"]+"/g) || [];
var wallBar = html.slice(html.indexOf('id="wall-filter-bar"'), html.indexOf('id="wall-filter-bar"') + 1200);
assert(wallBar.includes('data-wall-filter="moment"'), 'Moment tab');
assert(wallBar.includes('data-wall-filter="normal"') && wallBar.includes('>Post<'), 'Post tab');
assert(wallBar.includes('data-wall-filter="timed"') && wallBar.includes('Extend Post'), 'Extend Post tab');
assert(wallBar.includes('data-wall-filter="generated"') && wallBar.includes('IDs / PEA'), 'IDs/PEA tab');
assert(wallBar.includes('data-wall-filter="text"'), 'Text tab');
assert(!wallBar.includes('data-wall-filter="trending"'), 'no Trending tab');
assert(!wallBar.includes('data-wall-filter="following"'), 'no Following tab');
assert(!wallBar.includes('data-wall-filter="foryou"'), 'no For You tab');
assert(!wallBar.includes('data-wall-filter="new"'), 'no New tab');
assert((wallBar.match(/data-wall-filter="/g) || []).length === 5, 'exactly 5 wall filter chips');
assert(html.includes("allowed=['moment','normal','timed','generated','text']"), 'setWallFilter allowlist is five');

// 4) IDs / PEA contain (not cover-crop)
assert(/#id-archive-list \.id-archive-card \.id-arch-media img\{[^}]*object-fit:\s*contain/.test(html), 'id-archive object-fit contain');
assert(html.includes('wall-ids-mode') && /wall-ids-mode[\s\S]{0,200}object-fit:contain/.test(html), 'Wall IDs tab uses contain');

console.log('\nWall / video / tabs checks passed');
