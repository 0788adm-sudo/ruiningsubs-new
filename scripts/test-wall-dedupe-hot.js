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

assert(html.includes('function isWallNativePost'), 'wall-native classifier');
assert(/if\(filter==='timed'\) return isWallTimedPost\(p\);[\s\S]{0,80}if\(isWallTimedPost\(p\)\) return false/.test(html), 'timed posts excluded from other Wall tabs');
assert(html.includes("isVideoPost(p)) return false") && html.includes('Videos belong in GoonTok'), 'Extend excludes videos');
assert(html.includes('wall-permanence-notice'), 'Wall permanence notice on section');
assert(/Permanent Wall post/.test(html), 'pre-publish permanence copy');
assert(/cannot be removed for free|Removal is not free/.test(html), 'not-free remove policy visible');
assert(!/Log in to mark Hot/.test(html), 'Hot no longer requires login toast');
assert(/fromGoonTok:true/.test(html) && /skipTimer:true/.test(html), 'GoonTok Hot skips timer gate');
assert(/rs_videos/.test(html) && /hotBumpWall/.test(html), 'Hot looks up rs_videos');
assert(/__videoCache\|\|\[\], posts\|\|\[\], normalFeedPosts/.test(html) || html.includes("window.__videoCache||[]], posts||[], normalFeedPosts"), 'findPostAnywhere keeps video caches');

console.log('\nWall dedupe + Hot guest checks passed');
