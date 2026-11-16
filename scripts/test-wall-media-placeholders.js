#!/usr/bin/env node
'use strict';
var fs = require('fs');
var path = require('path');
var html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
function assert(c, m) {
  if (!c) {
    console.error('FAIL · ' + m);
    process.exit(1);
  }
  console.log('PASS · ' + m);
}

assert(html.includes('function wallImageHtml'), 'wallImageHtml helper');
assert(html.includes('nf-media-frame'), 'media frame placeholder wrapper');
assert(html.includes('Loading photo…'), 'image loading placeholder copy');
assert(html.includes('Photo failed to load'), 'image error state');
assert(/function __nfImgRetry|window\.__nfImgRetry/.test(html), 'image retry helper');
assert(html.includes('is-loaded'), 'marks frame loaded');
assert(html.includes('do not attach src just to mint a poster') || html.includes('Tap-to-play stays available'), 'Safari warm path skips blind metadata stampede');
assert(html.includes('var pageSize=more?40:24'), 'smaller Wall first page');
assert(html.includes('mergeSbRecentInto') || html.includes('Defer Supabase merge'), 'SB merge deferred after first paint');
assert(html.includes('function publicMediaUrl') && html.includes('function fetchableMediaUrl'), 'dual-host media URLs');
assert(/function feedThumb[\s\S]{0,280}publicMediaUrl/.test(html), 'feedThumb rewrites to R2');
assert(html.includes('lv-retry') && html.includes('function lvSetStatus'), 'video retry UI');
assert(
  /function normalFeedPostHtml[\s\S]{0,2200}isVidPost/.test(html) &&
    /function normalFeedPostHtml[\s\S]{0,2800}never force JPEG media_url into <video>/.test(html),
  'Wall cards gate <video> on real video posts'
);
assert(
  /function normalFeedPostHtml[\s\S]{0,2600}var filteredVid=/.test(html) &&
    /function normalFeedPostHtml[\s\S]{0,3200}isVidPost[\s\S]{0,400}lazyVideoHtml/.test(html),
  'Wall video branch requires isVidPost before lazyVideoHtml'
);

console.log('\nWall media placeholder / speed checks passed');
