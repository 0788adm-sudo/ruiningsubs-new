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

// 3) Wall tabs — Tasks / Post / Extend / Dominants / IDs·PEA / Text
var wallBar = html.slice(html.indexOf('id="wall-filter-bar"'), html.indexOf('id="wall-filter-bar"') + 1800);
assert(wallBar.includes('data-wall-filter="tasks"') && wallBar.includes('>Tasks<'), 'Tasks tab');
assert(wallBar.includes('data-wall-filter="normal"') && wallBar.includes('>Post<'), 'Post tab');
assert(wallBar.includes('data-wall-filter="timed"') && wallBar.includes('Extend Post'), 'Extend Post tab');
assert(wallBar.includes('data-wall-filter="dominants"') && wallBar.includes('>Dominants<'), 'Dominants tab');
assert(wallBar.includes('data-wall-filter="generated"') && wallBar.includes('IDs / PEA'), 'IDs/PEA tab');
assert(wallBar.includes('data-wall-filter="text"'), 'Text tab');
assert(!wallBar.includes('data-wall-filter="roulette"'), 'Roulette tab replaced by Tasks');
assert(!wallBar.includes('data-wall-filter="moment"'), 'no Moment tab');
assert(!wallBar.includes('data-wall-filter="trending"'), 'no Trending tab');
assert(!wallBar.includes('data-wall-filter="following"'), 'no Following tab');
assert(!wallBar.includes('data-wall-filter="foryou"'), 'no For You tab');
assert(!wallBar.includes('data-wall-filter="new"'), 'no New tab');
assert((wallBar.match(/data-wall-filter="/g) || []).length === 6, 'exactly 6 wall filter chips');
assert(html.includes("allowed=['tasks','normal','timed','dominants','generated','text']"), 'setWallFilter allowlist includes Tasks');
assert(html.includes('id="wall-dominants-soon"') && html.includes('Coming soon… Masters ready to dominate you.'), 'Dominants coming-soon screen');
assert(html.includes('COMING SOON') && html.includes('wall-dominants-soon-label'), 'COMING SOON label on Dominants');

// Category order: Tasks → Post → Extend → Dominants → IDs → Text
var orderIdx = ['tasks', 'normal', 'timed', 'dominants', 'generated', 'text'].map(function (f) {
  return wallBar.indexOf('data-wall-filter="' + f + '"');
});
assert(orderIdx.every(function (n) { return n >= 0; }) && orderIdx.join(',') === orderIdx.slice().sort(function (a, b) { return a - b; }).join(','), 'Wall category order Tasks→Post→Extend→Dominants→IDs→Text');

// Sort controls + Tasks CTA
assert(html.includes('id="wall-sort-bar"') && html.includes('data-wall-sort="recent"') && html.includes('data-wall-sort="interaction"'), 'per-category Most Recent / Most Interaction');
assert(html.includes('wallInteractionScore') && html.includes("wallSortMode==='interaction'"), 'interaction sort uses dynamic score');
assert(html.includes('id="wall-tasks-cta"') && html.includes('openRoulette()') && html.includes('openDiceGame()'), 'Tasks feed game CTAs');
assert(html.includes('function isGameTaskWallPost') && html.includes("filter==='tasks'"), 'Tasks posts unified by category');
assert(html.includes('function isRouletteWallPost'), 'legacy roulette detector kept');

// 4) IDs / PEA contain (not cover-crop)
assert(/#id-archive-list \.id-archive-card \.id-arch-media img\{[^}]*object-fit:\s*contain/.test(html), 'id-archive object-fit contain');
assert(html.includes('wall-ids-mode') && /wall-ids-mode[\s\S]{0,200}object-fit:contain/.test(html), 'Wall IDs tab uses contain');

console.log('\nWall / video / tabs checks passed');
