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

assert(html.includes('__suppressAutoOpenPost'), 'suppress auto-open while navigating sections');
assert(html.includes('Never auto-open a post while the user is mid-navigation'), 'openHashPost respects nav suppress');
assert(/feat-slide[\s\S]{0,120}No outer onclick|No outer onclick[\s\S]{0,80}feat-slide/.test(html) || !/feat-slide"[^>]*onclick="openDetail/.test(html), 'Spotlight slides do not auto-open via outer onclick');
assert(!/class="feat-slide"[^>]*onclick="openDetail/.test(html), 'no feat-slide outer openDetail onclick');
assert(html.includes("openCardFromEvent") && html.includes('.feat-carousel,#feat-carousel,.feat-slide'), 'fast-tap path ignores Spotlight carousel');
assert(/Only real post cards/.test(html) || /article\.post,article\.normal-feed-post,article\.id-archive-card/.test(html), 'card open requires real article cards');

assert(/function goontokTimed\(p\)\{[\s\S]*return false/.test(html), 'GoonTok videos never timed');
assert(html.includes('gt-act gt-hot') && html.includes('hotBumpGoonTok'), 'GoonTok keeps Hot on videos');
assert(/skipTimer:true/.test(html) && /fromGoonTok:true/.test(html), 'video Hot skips timer gate');
assert(html.includes('showExtendBtn=!detailIsVideo') || html.includes('Videos are permanent'), 'detail: videos Hot-only (no Extend)');
assert(html.includes('window.__routing && typeof parseSharedPostId') || html.includes("window.__routing && typeof parseSharedPostId==='function'"), 'sticky ?p= cleared on user section nav');

console.log('\nAuto-open + video Hot checks passed');
