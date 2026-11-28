#!/usr/bin/env node
'use strict';
/**
 * Guards for FEED unification (EXTENDED + ALL POSTS) and EXPLORE discovery hub.
 * Aligned with main's dual-panel FEED tabs (panel-feed + panel-wall) from #173.
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

// Bottom nav: exactly Feed / GoonTok / Create / Explore / Profile
assert(html.includes('data-p="feed"') && /nav-item[^>]*>[\s\S]*?Feed/.test(html), 'FEED in bottom nav');
assert(html.includes('data-p="goontok"'), 'GOONTOK in bottom nav');
assert(html.includes('data-p="post"'), 'CREATE in bottom nav');
assert(html.includes('data-p="explore"'), 'EXPLORE in bottom nav');
assert(html.includes('data-p="profile"') && /data-p="profile"[\s\S]*?Profile/.test(html), 'PROFILE in bottom nav');
assert(!/data-p="wall"/.test(html), 'Wall is not a bottom-nav destination');

// Feed tabs — single floating switch above bottom nav
assert(html.includes('id="feed-float-switch"') && html.includes('feed-float-switch'), 'floating feed switch present');
assert(html.includes('data-feed-tab="extended"') && html.includes('EXTENDED'), 'EXTENDED tab');
assert(html.includes('data-feed-tab="all"') && html.includes('ALL POSTS'), 'ALL POSTS tab');
assert(html.includes('id="panel-feed"') && html.includes('id="panel-wall"'), 'EXTENDED and ALL POSTS panels');
assert(html.includes('function openFeedAllPosts'), 'openFeedAllPosts helper');
assert(html.includes('function syncFeedModeTabs') || html.includes('data-feed-tab'), 'feed tab sync');
assert(html.includes('function syncFeedFloatVisibility'), 'floating switch visibility sync');
assert((html.match(/id="feed-float-switch"/g) || []).length === 1, 'exactly one feed switch instance');
// Placement: Exposure Videos → feed search (tabs float; not inline above search)
(function () {
  var m = html.match(/id="panel-feed"[\s\S]*?id="posts-container"/);
  assert(!!m, 'panel-feed extract for tab order');
  var b = m[0];
  assert(b.indexOf('home-videos-wrap') < b.indexOf('feed-search-wrap'), 'Exposure Videos above feed search');
  assert(b.indexOf('feed-mode-tabs') < 0 && b.indexOf('data-feed-tab') < 0, 'no inline feed tabs in panel-feed');
})();

// ALL POSTS filters
['ALL', 'GAMES', 'ID', 'PEA', 'REGULAR POSTS', 'TIMED POSTS'].forEach(function (label) {
  assert(html.includes('>' + label + '<'), 'All Posts filter label ' + label);
});
assert(html.includes('data-wall-filter="tasks"') || html.includes('data-wall-filter="games"'), 'games proofs filter key');
assert(html.includes('data-wall-filter="id"') && html.includes('data-wall-filter="pea"'), 'id/pea filter keys');
assert(html.includes('Most Recent') && html.includes('Most Interaction'), 'All Posts sort chips');
assert(html.includes('id="wall-search"') || html.includes('all-posts-search') || html.includes('Search posts, users, topics'), 'ALL POSTS own search');
assert(html.includes('id="feed-search"'), 'EXTENDED own search');

// Explore discovery hub
assert(/Search users, content or topics/i.test(html) || /Search users/i.test(html), 'Explore search placeholder');
assert(html.includes('openFeedAllPosts()'), 'Explore → ALL POSTS entry');
assert(html.includes('TRENDING') && (html.includes('EXPOSURE MAP') || html.includes('Exposure map')), 'Discover section');
assert(html.includes('explore-map-card') && html.includes('Open Map'), 'Exposure Map retained');
assert(/TOPICS/i.test(html), 'Topics section in Explore');
assert(html.includes('__wallTopicFilter') || html.includes('wallTopicFilter'), 'topic filter state');
assert(html.includes('clearWallTopic') || html.includes("__wallTopicFilter=''"), 'clearable topic filter');
assert(/PLAY/i.test(html) && (/GAMES/i.test(html) || html.includes('openChallengesHub')), 'Play / Games');
assert(html.includes('ID Generator') && html.includes('PEA Generator'), 'Tools generators');
assert(html.includes('Random Video Chat'), 'More tools retained');

// Videos: no Download in catalog cards
assert(!/class="vid-card"[\s\S]{0,800}downloadPost/.test(html) || html.includes('vid-catalog'), 'Videos catalog path present');
assert(html.includes('Most Viewed') && html.includes('Newest') && html.includes('Trending'), 'Videos sort options');

// Routes / nav: wall opens All Posts under FEED
assert(html.includes('openFeedAllPosts'), 'wall/all posts entry helper');

// Matcher helpers for six filters
function extractFn(name) {
  var re = new RegExp('function ' + name + '\\([\\s\\S]*?\\n    \\}');
  var m = html.match(re);
  if (!m) throw new Error('missing ' + name);
  return m[0] + '\n';
}
var sandbox = {
  isVideoPost: function (p) {
    var tg = (p && p.tags) || [];
    return tg.indexOf('goontok') >= 0 || tg.indexOf('video') >= 0 || p._kind === 'video';
  },
  isPeaOrIdPost: function (p) {
    var tg = (p && p.tags) || [];
    return tg.indexOf('generated_id') >= 0 || tg.indexOf('generated_pea') >= 0 || tg.indexOf('idcard') >= 0 || tg.indexOf('pea') >= 0;
  },
  isTimelessWallPost: function (p) {
    var exp = Number(p && p.expires || 0);
    if (!exp || !isFinite(exp)) return true;
    return exp > Date.now() + 60 * 24 * 3600 * 1000;
  },
  isRouletteWallPost: function (p) {
    return ((p.tags || []).indexOf('roulette') >= 0);
  },
  isGameTaskWallPost: function (p) {
    var tg = p.tags || [];
    return tg.indexOf('roulette') >= 0 || tg.indexOf('dice') >= 0 || tg.indexOf('tic_tac_toe') >= 0;
  },
  isWallTimedPost: function (p) {
    if (!p) return false;
    if (sandbox.isPeaOrIdPost(p)) return false;
    if (sandbox.isVideoPost(p)) return false;
    var exp = Number(p.expires || 0);
    if (!exp || !isFinite(exp)) return false;
    var now = Date.now();
    return exp > now && exp <= now + 60 * 24 * 3600 * 1000;
  },
  isWallNormalPost: function (p) {
    if (!p) return false;
    if (sandbox.isPeaOrIdPost(p)) return false;
    if (sandbox.isGameTaskWallPost(p)) return false;
    if (sandbox.isWallTimedPost(p)) return false;
    return sandbox.isTimelessWallPost(p);
  },
  isWallTextPost: function () { return false; },
  isWallNativePost: function () { return true; },
  isWallUnifiedPost: function (p) {
    return !!(p && !sandbox.isVideoPost(p));
  },
  isWallFollowingPost: function () { return false; },
  isWallNewPost: function () { return false; },
  isWallForYouPost: function () { return false; },
  isWallTrendingPost: function () { return false; },
  wallFilter: 'all',
  console: console,
  window: {}
};
sandbox.isIdPost = function (p) {
  if (!p || !sandbox.isPeaOrIdPost(p)) return false;
  var tg = p.tags || [];
  if (tg.indexOf('generated_pea') >= 0 || tg.indexOf('pea') >= 0) return false;
  return tg.indexOf('generated_id') >= 0 || tg.indexOf('idcard') >= 0 || tg.indexOf('id') >= 0;
};
sandbox.isPeaPost = function (p) {
  if (!p || !sandbox.isPeaOrIdPost(p)) return false;
  var tg = p.tags || [];
  return tg.indexOf('generated_pea') >= 0 || tg.indexOf('pea') >= 0 || String(p.title || '').toLowerCase().indexOf('pea') >= 0;
};
var src = extractFn('matchesWallFilter');
try { src = extractFn('isIdPost') + extractFn('isPeaPost') + src; } catch (e) {}
vm.createContext(sandbox);
vm.runInContext(src, sandbox);

var now = Date.now();
var samples = [
  { id: 1, title: 'Wall photo', tags: ['normal_feed'], created: now, expires: 0, images: ['a.jpg'], user: 'a' },
  { id: 2, title: 'Extend me', tags: ['exposed'], created: now, expires: now + 3600000, images: ['b.jpg'], user: 'b' },
  { id: 3, title: 'Roulette', tags: ['roulette', 'game_origin:roulette'], created: now, expires: 0, images: ['c.jpg'], user: 'c' },
  { id: 4, title: 'Published ID', tags: ['generated_id', 'idcard'], created: now, expires: 0, images: ['d.jpg'], user: 'd' },
  { id: 5, title: 'Published PEA', tags: ['generated_pea', 'pea'], created: now, expires: 0, images: ['e.jpg'], user: 'e' }
];
assert(samples.filter(function (p) { return sandbox.matchesWallFilter(p, 'tasks') || sandbox.matchesWallFilter(p, 'games'); }).map(function (p) { return p.id; }).indexOf(3) >= 0, 'GAMES filter hits roulette');
assert(samples.filter(function (p) { return sandbox.matchesWallFilter(p, 'id'); }).map(function (p) { return p.id; }).indexOf(4) >= 0, 'ID filter hits id posts');
assert(samples.filter(function (p) { return sandbox.matchesWallFilter(p, 'pea'); }).map(function (p) { return p.id; }).indexOf(5) >= 0, 'PEA filter hits pea posts');
assert(samples.filter(function (p) { return sandbox.matchesWallFilter(p, 'timed'); }).map(function (p) { return p.id; }).indexOf(2) >= 0, 'TIMED filter hits timed posts');
assert(samples.filter(function (p) { return sandbox.matchesWallFilter(p, 'normal'); }).map(function (p) { return p.id; }).indexOf(1) >= 0, 'REGULAR filter hits normal posts');

console.log('\nFeed + Explore unify checks passed');
