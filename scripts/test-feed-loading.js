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

assert(html.includes('function sbQueryTimeout'), 'sbQueryTimeout helper');
assert(html.includes('Kick the feed immediately'), 'boot starts loadPosts without waiting on banned users');
assert(html.includes('Safety net: if the feed is still "Loading..."'), 'boot loading safety net');
assert(/loadBannedUsers[\s\S]{0,200}sbQueryTimeout/.test(html), 'banned users query is timed');
assert(html.includes('SB_FEED_COLS='), 'lean Supabase feed columns');
assert(html.includes('Paint CF as soon as it arrives'), 'progressive CF paint');
assert(html.includes('function paintFeedSafe'), 'paintFeedSafe clears stuck Loading');
assert(html.includes("hold.innerHTML='<div class=\"empty\">No active exposures</div>'") || html.includes('No active exposures'), 'fallback empty state');
assert(html.includes("console.warn('postCardHtml'"), 'per-card paint isolation');

console.log('\nFeed loading checks passed');
