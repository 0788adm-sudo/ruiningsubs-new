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

// 3) All Posts primary filters — ALL / GAMES / ID / PEA / REGULAR POSTS / TIMED POSTS
var wallBar = html.slice(html.indexOf('id="wall-filter-bar"'), html.indexOf('id="wall-filter-bar"') + 2000);
assert(wallBar.includes('data-wall-filter="all"') && wallBar.includes('>ALL<'), 'ALL tab');
assert(wallBar.includes('data-wall-filter="tasks"') && wallBar.includes('>GAMES<'), 'GAMES tab');
assert(wallBar.includes('data-wall-filter="id"') && wallBar.includes('>ID<'), 'ID tab');
assert(wallBar.includes('data-wall-filter="pea"') && wallBar.includes('>PEA<'), 'PEA tab');
assert(wallBar.includes('data-wall-filter="normal"') && wallBar.includes('>REGULAR POSTS<'), 'REGULAR POSTS tab');
assert(wallBar.includes('data-wall-filter="timed"') && wallBar.includes('>TIMED POSTS<'), 'TIMED POSTS tab');
assert(!wallBar.includes('data-wall-filter="dominants"'), 'Dominants no longer primary chip');
assert(!wallBar.includes('data-wall-filter="generated"'), 'combined IDs/PEA chip removed');
assert(!wallBar.includes('data-wall-filter="text"'), 'Text no longer primary chip');
assert(!wallBar.includes('data-wall-filter="roulette"'), 'Roulette tab replaced by Games');
assert((wallBar.match(/data-wall-filter="/g) || []).length === 6, 'exactly 6 wall filter chips');
assert(html.includes("allowed=['all','tasks','id','pea','normal','timed']"), 'setWallFilter allowlist v3');
assert(html.includes('rs_wall_filters_v3'), 'filters v3 migration');

// Sort controls + Games CTA
assert(html.includes('id="wall-sort-bar"') && html.includes('data-wall-sort="recent"') && html.includes('data-wall-sort="interaction"'), 'per-category Most Recent / Most Interaction');
assert(html.includes('wallInteractionScore') && html.includes("wallSortMode==='interaction'"), 'interaction sort uses dynamic score');
assert(html.includes('id="wall-tasks-cta"') && html.includes('openRoulette()') && html.includes('openDiceGame()'), 'Games feed CTAs');
assert(html.includes('function isGameTaskWallPost') && html.includes("filter==='tasks'"), 'Games posts unified by category');
assert(html.includes('function isWallUnifiedPost') && html.includes("filter==='all'"), 'All Posts unified matcher');
assert(html.includes('function isRouletteWallPost'), 'legacy roulette detector kept');
assert(html.includes('function wallCategoryBadgeHtml'), 'category badges for mixed feed');
assert(html.includes('rs_wall_unified_v1'), 'one-time migration to All Posts');

// Topics discovery on Explore
assert(html.includes('id="explore-topics-panel"') && html.includes('function openTopicInAllPosts'), 'Topics on Explore open All Posts');
assert(html.includes('data-feed-tab="extended"') && html.includes('data-feed-tab="all"'), 'FEED tabs');

// Videos catalog
assert(html.includes('vid-catalog') && html.includes('Most Viewed'), 'Videos catalog sorts');
assert(!/vid-catalog-card[\s\S]{0,1200}downloadPost/.test(html), 'no Download on catalog cards');

console.log('\nWall / video / tabs checks passed');
