#!/usr/bin/env node
'use strict';
/**
 * Feed Exposure Map shortcut + Explore Topics simplification guards.
 */
var fs = require('fs');
var path = require('path');
var vm = require('vm');
var html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

function assert(c, m) {
  if (!c) {
    console.error('FAIL:', m);
    process.exit(1);
  }
  console.log('PASS ·', m);
}

// —— Phase 1: Map lives in Explore TOOLS (not Feed chrome) ——
assert(html.includes('id="btn-feed-exposure-map"'), 'legacy Feed map hook id retained');
var feedSlice = html.slice(html.indexOf('id="panel-feed"'), html.indexOf('id="posts-container"'));
assert(/id="feed-tools-legacy"[\s\S]*?btn-feed-exposure-map/.test(feedSlice), 'Feed map hook is hidden legacy only');
assert(!/EXPOSURE MAP[\s\S]{0,120}Discover users around the world/.test(feedSlice), 'visible Feed map card removed');
assert(feedSlice.indexOf('home-random-strip') >= 0 && feedSlice.indexOf('btn-go-public') >= 0, 'EXTENDED Stories + GO PUBLIC retained');

// —— Explore: world map kept under TOOLS ——
assert(!html.includes('btn-explore-map-card'), 'Explore promo map card removed');
assert(!/explore-card-map/.test(html), 'explore-card-map class removed');
assert(html.includes('id="explore-map-preview"') && html.includes('btn-explore-open-map'), 'world map + Open Map kept');
assert(html.includes('id="btn-explore-trending"') && html.includes('openExploreTrending'), 'Trending card kept');
assert(html.includes('btn-explore-browse-all'), 'soft Browse All Posts in Explore DISCOVER');

// —— Topics simplified ——
assert(html.includes('TRENDING TOPICS'), 'TRENDING TOPICS section');
assert(!html.includes('POPULAR TOPICS'), 'Popular Topics removed');
assert(!html.includes('RECENT TOPICS'), 'Recent Topics removed');
assert(!html.includes('VIEW ALL TOPICS'), 'View All removed');
assert(!html.includes('id="explore-topics-search"'), 'Search topics removed from Explore');
assert(!html.includes('id="trending-tags"'), 'duplicate trending-tags block removed');
assert(html.includes('function trendingTopicStats'), 'live frequency helper');
assert(html.includes('trendingTopicStats(6)'), 'caps at 6 terms');
assert(html.includes('function openTopicInAllPosts'), 'hashtags open related posts');

// —— Untouched surfaces ——
assert(html.includes('id="home-random-strip"') && html.includes('function renderWallStories'), 'Stories intact on Extended');
assert(!html.includes('id="wall-stories"'), 'Stories removed from All Posts');
assert(html.includes('id="wall-filter-bar"') && html.includes('data-wall-filter="all"'), 'All Posts filters intact');
assert(html.includes('class="nav-row"') || html.includes('nav-item'), 'bottom nav present');
assert(html.includes('openExposureMap') && /window\.openExposureMap\s*=/.test(html), 'openExposureMap helper retained (Explore + shared callers)');

// —— Logic: trendingTopicStats from real posts ——
function extractFn(name) {
  var re = new RegExp('function ' + name + '\\([\\s\\S]*?\\n    \\}\\n');
  var m = html.match(re);
  if (!m) throw new Error('missing ' + name);
  return m[0];
}
var sandbox = {
  COMMUNITIES: [],
  normalFeedPosts: [],
  posts: [
    { id: 1, title: 'Hello #piggy', tags: ['piggy', 'normal_feed', 'exposed'], created: 3 },
    { id: 2, title: 'More', tags: ['piggy', 'cuck', 'goontok'], created: 2 },
    { id: 3, title: '#cuck again', tags: ['cuck', 'video'], created: 1 },
    { id: 4, title: 'Solo #diaper', tags: ['diaper', 'ext_60', 'gender_man', 'account:anonymous', 'del:deletable'], created: 0 },
    { id: 5, title: 'Rare #zzz', tags: ['zzz', 'del:permanent', 'account:registered'], created: 0 }
  ],
  console: console,
  window: {}
};
sandbox.publicationPoolForTopics = function () {
  return sandbox.posts.slice();
};
var sysMatch = html.match(/var TOPIC_SYSTEM_TAGS=\{[\s\S]*?\};/);
assert(!!sysMatch, 'TOPIC_SYSTEM_TAGS defined');
var src =
  'function normalizeTopicKey(raw){return String(raw||\'\').toLowerCase().replace(/^#/,\'\').replace(/\\s+/g,\'\').replace(/[^a-z0-9_-]/g,\'\').slice(0,40);}\n' +
  sysMatch[0] + '\n' +
  extractFn('isTrendingTopicTerm') +
  extractFn('trendingTopicStats');
vm.createContext(sandbox);
vm.runInContext(src, sandbox);

var top = sandbox.trendingTopicStats(6);
assert(top.length <= 6, 'returns at most 6');
assert(top[0].id === 'cuck' && top[0].count === 2, 'cuck is top with real count 2');
assert(top.some(function (t) { return t.id === 'piggy' && t.count === 2; }), 'piggy count 2');
assert(top.some(function (t) { return t.id === 'diaper' && t.count === 1; }), 'diaper from real posts');
assert(!top.some(function (t) { return t.id === 'normal_feed' || t.id === 'goontok' || t.id === 'video'; }), 'system tags excluded');
assert(!top.some(function (t) { return t.id === 'ext_60' || t.id === 'gender_man'; }), 'internal tags excluded');
assert(!top.some(function (t) {
  return /^(account|del)/.test(t.id) || t.id === 'accountanonymous' || t.id === 'deldeletable';
}), 'account/del tier tags excluded even after normalize');

var top3 = sandbox.trendingTopicStats(3);
assert(top3.length === 3, 'limit respected when enough terms exist');

sandbox.posts = [{ id: 9, title: 'no tags', tags: ['normal_feed'], created: 1 }];
var emptyish = sandbox.trendingTopicStats(6);
assert(emptyish.length === 0, 'no invented stats when only system tags');

console.log('\nFeed map + Topics checks passed');
