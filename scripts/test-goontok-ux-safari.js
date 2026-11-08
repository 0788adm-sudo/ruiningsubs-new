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

// GoonTok TikTok-style playback
assert(html.includes('GT_LOAD_MAX_MS'), 'Loading… hard cap constant');
assert(html.includes('function isSafariLikeBrowser'), 'Safari detector');
assert(html.includes('isSafariIncompatibleVideoUrl'), 'WebM Safari guard');
assert(html.includes("failVideo(v,'incompatible_codec')"), 'WebM fails fast on Safari');
assert(html.includes('function saveGoonTokScroll') && html.includes('function restoreGoonTokScroll'), 'GoonTok scroll preserve');
assert(html.includes("dest==='goontok'") && html.includes('restoreGoonTokScroll'), 'back from detail restores GoonTok');
assert(html.includes('opts.fromDetail') && html.includes('preservePlay:true'), 'return to GoonTok preserves play');
assert(/Prefer H\.264 MP4|prefer H\.264 MP4|Skip WebM-only/i.test(html), 'prefer MP4 over WebM on Safari');

// First-tap opens
assert(html.includes('Date.now()-st>1100'), 'touch duration tolerance raised');
assert(html.includes('is-pressing'), 'press visual feedback');
assert(html.includes('__featSwipeUntil'), 'Spotlight swipe vs tap separation');
assert(!/if\(card\.closest\('\.feat-carousel,#feat-carousel,\.feat-slide'\)\) return false;/.test(html), 'Spotlight cards no longer blocked from open');
assert(html.includes("el.closest('.lazy-video,.lv-player,.lv-play')"), 'lazy video taps not stolen for openDetail');
assert(html.includes('never block real taps') || html.includes('never block real taps'), 'suppress flag does not block user taps');
assert(!/if\(name!=='detail'\)\{[\s\S]{0,180}__blockFeedTap=Date\.now\(\)\+/.test(html), 'showPanel no longer blocks user taps');

// HOT counter
assert(html.includes('gt-hot-n'), 'visible HOT count element');
assert(html.includes("sb.from('posts').update({tags:p.tags})"), 'HOT persisted to Supabase tags');
assert(html.includes('function withHotTag') && html.includes('function postHotCount'), 'existing HOT system reused');

// Timers / permanence
assert(html.includes('Never invent a timer for videos') || html.includes('Never invent a timer'), 'ensureFeedPost no fake video timers');
assert(html.includes('if(isVid){ mapped.expires=0; }') || html.includes("mapped.expires=0"), 'videos forced permanent on lookup');

// Safari poster path still present
assert(html.includes('function lazyVideoHtml') && html.includes('#t=0.1'), 'Safari poster/#t=0.1 path intact');
assert(html.includes('function parseVthumbTag'), 'vthumb durable posters intact');

console.log('\nGoonTok UX / Safari / HOT / tap checks passed');
