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

console.log('\nWall media placeholder / speed checks passed');
