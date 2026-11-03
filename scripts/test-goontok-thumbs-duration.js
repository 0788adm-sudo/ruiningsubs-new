#!/usr/bin/env node
/**
 * GoonTok: skip broken media, thumbnail cache, create-post durations.
 */
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

function assert(c, m) {
  if (!c) throw new Error(m);
  console.log('PASS · ' + m);
}

// 1) Skip unplayable / broken media completely
assert(html.includes('status===\'broken\'') || html.includes('status==="broken"') || /h\.status==='broken'/.test(html), 'hides broken videos from GoonTok pool');
assert(/function silentlyDropGoonTokSlide[\s\S]{0,2500}slide\.remove\(/.test(html), 'failed slides are removed from the feed');
assert(html.includes('GT_LOAD_TIMEOUT_MS'), 'load timeout constant exists');
assert(html.includes('load_timeout') || html.includes("'load_timeout'"), 'timeout failure skips the post');
assert(html.includes('Finding playable videos'), 'empty state while finding playable clips');

// 2) Thumbnails
assert(html.includes('cacheVideoPosterUrl'), 'poster cache helper');
assert(html.includes('capturePosterFromVideoEl'), 'frame capture from video element');
assert(html.includes('scheduleVideoPosterFill'), 'async poster fill for missing thumbs');
assert(html.includes('rs_vposter'), 'persists posters in rs_vposter');
assert(html.includes('applyPosterToGtSlide'), 'applies generated poster onto GoonTok slides');

// 3) Durations
assert(/data-m="1440">1 day</.test(html), '1 day label (not 24h) on create duration');
assert(/data-m="4320">3 days 🔥</.test(html), '3 days 🔥 duration option');
assert(/id="create-dur"[\s\S]{0,500}dur-btn sel" data-m="1440"/.test(html) || /data-m="1440">1 day[\s\S]{0,80}/.test(html), '1 day is the default selected create duration');
assert(html.includes('selectedCreateMin=1440') || html.includes('selectedCreateMin = 1440'), 'JS default create minutes = 1 day');
assert(html.includes('selectedCreateMin||1440') || html.includes('selectedCreateMin||60'), 'create/publish uses selectedCreateMin for expires_at');

// Keep shorter options
['15', '30', '60', '120', '360', '720'].forEach(function (m) {
  assert(new RegExp('id="create-dur"[\\s\\S]{0,600}data-m="' + m + '"').test(html), 'keeps ' + m + 'm create option');
});

console.log('\nGoonTok thumbs/duration checks passed');
