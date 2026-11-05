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

assert(/function goontokTimed\(p\)\{[\s\S]*postHasActiveTimer/.test(html), 'GoonTok timed uses postHasActiveTimer');
assert(html.includes('gt-act gt-ext') && html.includes('gt-keep'), 'GoonTok shows Extend for timed videos');
assert(html.includes('gt-act gt-hot') && html.includes('hotBumpGoonTok'), 'GoonTok keeps Hot on videos');
assert(/Timed videos → Extend \+ Hot|timed videos may show BOTH|detailIsVideo \? \(extendLed \+ hotLed\)/.test(html), 'timed videos show Extend + Hot');
assert(/skipTimer:true/.test(html) && /fromGoonTok:true/.test(html), 'video Hot skips timer gate');
assert(/if\(!hasTimer\)\{[\s\S]*return hotBtn \+ cmtBtn[\s\S]*return isVid \? \(extBtn \+ hotBtn/.test(html) || html.includes('return isVid ? (extBtn + hotBtn + cmtBtn)'), 'feed cards: permanent Hot-only, timed video Extend+Hot');
assert(html.includes('window.__routing && typeof parseSharedPostId') || html.includes("window.__routing && typeof parseSharedPostId==='function'"), 'sticky ?p= cleared on user section nav');

console.log('\nAuto-open + timed-video Hot/Extend checks passed');
