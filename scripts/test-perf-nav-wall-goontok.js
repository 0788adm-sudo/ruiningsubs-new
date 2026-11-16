#!/usr/bin/env node
'use strict';
/**
 * Regression guards for Wall/GoonTok navigation + media performance work.
 */
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

assert(html.includes('function refreshWallSection'), 'Wall TTL refresh helper');
assert(html.includes('function wallCacheFresh'), 'Wall cache freshness helper');
assert(html.includes('WALL_CACHE_TTL_MS'), 'Wall cache TTL constant');
assert(html.includes('function scheduleSectionPrefetch'), 'idle section prefetch');
assert(html.includes("refreshWallSection({force:!!opts.forceRefresh})"), 'showPanel uses TTL wall refresh');
assert(
  !/slug==='normal'[\s\S]{0,120}showPanel\('wall'\); try\{loadNormalFeed\(\)/.test(html),
  'route handler no longer double-fetches Wall'
);
assert(html.includes('Cache-first: paint from local pools immediately'), 'openDetail cache-first paint');
assert(html.includes('Background verify — never block first paint'), 'openDetail background ensureFeedPost');
assert(html.includes('gotPrimary<24'), 'video catalog skips duplicate SB fan-out when healthy');
assert(html.includes("preload='auto'") || html.includes('preload="auto"') || html.includes("v.preload='auto'"), 'GoonTok neighbor preload auto');
assert(html.includes('IntersectionObserver') || html.includes('__gtIO'), 'GoonTok intersection observer present');
assert(html.includes('function softFailGoonTokSlide'), 'GoonTok soft-fail + Retry intact');
assert(html.includes('GT_LOAD_MAX_MS'), 'GoonTok Loading chip hard cap intact');
assert(html.includes('function publicMediaUrl') && html.includes('function fetchableMediaUrl'), 'dual-host media URLs intact');
assert(html.includes('window.__nfImgRetry'), 'image retry intact');
assert(html.includes('loadNormalFeed(false,{quiet:true})') || html.includes('quiet:true'), 'quiet Wall refresh path');
assert(html.includes('.limit(200)') || html.includes(".limit(200)"), 'follows list bounded');
assert(html.includes('.limit(500)'), 'banned profiles query bounded');
assert(html.includes('__cfAvatarsDead'), 'CF avatars 404 soft-disable');

console.log('\nPerf / nav / Wall / GoonTok guards passed');
