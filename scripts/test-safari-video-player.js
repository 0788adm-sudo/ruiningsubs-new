#!/usr/bin/env node
'use strict';
var fs = require('fs');
var path = require('path');
var html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
var api = fs.readFileSync(path.join(__dirname, '..', 'api', 'videos.js'), 'utf8');
function assert(c, m) {
  if (!c) {
    console.error('FAIL:', m);
    process.exit(1);
  }
  console.log('PASS ·', m);
}

// 1) lazyVideoHtml must not leave Safari with preload=none + empty src (black card)
assert(html.includes('function lazyVideoHtml'), 'lazyVideoHtml exists');
// Cards start with preload=none and no src (avoid moov-at-end bandwidth stampede).
// Warm/activate attach the R2 src for the visible/tapped clip only.
assert(/function lazyVideoHtml[\s\S]{0,1200}preload="none"/.test(html), 'lazyVideoHtml defers src with preload=none');
assert(/function lazyVideoHtml[\s\S]{0,1600}data-video-src=/.test(html), 'lazyVideoHtml keeps data-video-src for activate');
assert(!/function lazyVideoHtml\([\s\S]{0,900}#t=0\.1/.test(html), 'lazyVideoHtml does not force #t=0.1');
assert(html.includes('Preparing video…'), 'loading state while player prepares');
assert(html.includes('lv-retry') && html.includes('function lvSetStatus'), 'Preparing has timeout + Retry path');
assert(html.includes('class="lv-player"'), 'dedicated lv-player class');
assert(html.includes('webkit-playsinline'), 'webkit-playsinline for iOS');
assert(html.includes('function fetchableMediaUrl'), 'CORS fetch URL helper for Worker');

// 2) activateLazyVideo plays the original (no fragment) with playsInline
assert(
  html.indexOf('function activateLazyVideo') >= 0 &&
    /function activateLazyVideo[\s\S]{0,2500}split\('#'\)\[0\]/.test(html),
  'activate strips # fragment'
);
assert(/function activateLazyVideo[\s\S]{0,4500}playsInline\s*=\s*true/.test(html), 'activateLazyVideo sets playsInline');
assert(/function activateLazyVideo[\s\S]{0,4500}webkit-playsinline/.test(html), 'activateLazyVideo sets webkit-playsinline');
assert(html.includes('bindLazyVideoEvents'), 'shared media event binder');

// 3) warmVideoThumb must arm preview (not a no-op)
assert(!/function warmVideoThumb\(el\)\{\s*\/\/ Intentionally no-op/.test(html), 'warmVideoThumb is no longer a no-op');
assert(html.includes('function warmVisibleLazyVideos'), 'warmVisibleLazyVideos helper');
assert(html.includes('warmVisibleLazyVideos(featBox)'), 'Spotlight warms lazy videos');

// 4) Feed cards use a real player, not a static img pretending to be video
assert(!/if\(poster && !isVideoUrl\(poster\)\) media='<img src="'\+esc\(poster\)/.test(html), 'postCardHtml no longer replaces video with static poster img');
assert(/isVideoPost[\s\S]{0,900}lazyVideoHtml\(vsrc,poster/.test(html), 'postCardHtml uses lazyVideoHtml for videos');

// 5) Durable poster tag for SB (no thumb_url column)
assert(html.includes('function parseVthumbTag') && html.includes('function withVthumbTag'), 'vthumb tag helpers');
assert(html.includes("tags=withVthumbTag(tags, posterUrl)") || html.includes('withVthumbTag(tags, posterUrl)'), 'publish stores vthumb tag');
assert(html.includes('withVthumbTag(tags, row.thumb_url)'), 'createCfPost SB fallback stores vthumb');
assert(api.includes('function parseVthumbTag') && api.includes('parseVthumbTag(tags)'), 'api/videos.js reads vthumb');
assert(html.includes("t.indexOf('vthumb:')===0") || html.includes("indexOf('vthumb:')"), 'publicTags / filters hide vthumb');

// 6) Poster resolution reads tag + cache
assert(/function videoPosterOf[\s\S]{0,800}parseVthumbTag/.test(html), 'videoPosterOf reads vthumb tag');
assert(/function sanitizeVideoPostMedia[\s\S]{0,900}parseVthumbTag/.test(html), 'sanitizeVideoPostMedia reads vthumb');

// 7) Detail + Wall paths
assert(html.includes('videoPosterOf(post, imgs[0]') || html.includes('videoPosterOf(post, imgs[0]||post.media_url'), 'openDetail uses videoPosterOf');
assert(
  html.includes('warmVisibleLazyVideos(wallActiveBox())') ||
    html.includes("warmVisibleLazyVideos(document.getElementById('normal-feed-posts')") ||
    html.includes('warmVisibleLazyVideos(document.getElementById(\'explore-normal-posts\')'),
  'Wall warms lazy videos'
);

console.log('\nSafari / iOS video player checks passed');
