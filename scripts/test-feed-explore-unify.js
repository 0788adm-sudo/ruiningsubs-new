#!/usr/bin/env node
'use strict';
/**
 * Guards for FEED unification (EXTENDED + ALL POSTS tabs) and EXPLORE discovery hub.
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
assert(html.includes('data-p="post"') && html.includes('CREATE'), 'CREATE in bottom nav');
assert(html.includes('data-p="explore"'), 'EXPLORE in bottom nav');
assert(html.includes('data-p="profile"') && /data-p="profile"[\s\S]*?Profile/.test(html), 'PROFILE in bottom nav');
assert(!/data-p="wall"/.test(html), 'Wall is not a bottom-nav destination');
assert(!/>Extend\s*</.test(html.replace(/panel-extended[\s\S]*?<\/div>/, '')), 'Extend is not a bottom-nav label');

// Feed tabs live inside panel-feed
assert(html.includes('id="feed-mode-tabs"'), 'feed-mode-tabs present');
assert(html.includes('data-feed-mode="extended"') && html.includes('>EXTENDED<'), 'EXTENDED tab card');
assert(html.includes('data-feed-mode="all"') && html.includes('>ALL POSTS<'), 'ALL POSTS tab card');
assert(html.includes('id="feed-extended-pane"') && html.includes('id="feed-all-posts-pane"'), 'both panes inside FEED');
assert(html.includes('id="all-posts-search"'), 'ALL POSTS own search');
assert(html.includes('id="feed-search"'), 'EXTENDED own search');
assert(html.includes('function setFeedTab'), 'setFeedTab helper');
assert(html.includes('function openFeedAllPosts'), 'openFeedAllPosts helper');

// ALL POSTS filters
['ALL', 'GAMES', 'ID', 'PEA', 'REGULAR POSTS', 'TIMED POSTS'].forEach(function (label) {
  assert(html.includes('>' + label + '<'), 'All Posts filter label ' + label);
});
assert(html.includes('data-wall-filter="games"'), 'games filter key');
assert(html.includes('data-wall-filter="id"') && html.includes('data-wall-filter="pea"'), 'id/pea filter keys');
assert(html.includes('Most Recent') && html.includes('Most Interaction'), 'All Posts sort chips');

// Explore discovery hub
assert(html.includes('Search users, content or topics'), 'Explore search placeholder');
assert(html.includes('btn-explore-all-posts') || html.includes('openFeedAllPosts()'), 'Explore → ALL POSTS entry');
assert(html.includes('DISCOVER') && html.includes('TRENDING') && html.includes('EXPOSURE MAP'), 'Discover section');
assert(html.includes('explore-map-card') && html.includes('Open Map'), 'Exposure Map retained');
assert(html.includes('>TOPICS<') || html.includes('explore-section-label topics'), 'Topics section in Explore');
assert(html.includes('POPULAR TOPICS') && html.includes('RECENT TOPICS'), 'Popular/Recent Topics');
assert(html.includes('searchExploreTopics') && html.includes('VIEW ALL TOPICS'), 'Search/View All Topics');
assert(html.includes('function openFeedWithTopic'), 'Topic → FEED/ALL POSTS bridge');
assert(html.includes('wall-topic-banner') && html.includes('clearWallTopic'), 'clearable topic filter banner');
assert(html.includes('>PLAY<') || html.includes('explore-section-label">PLAY'), 'Play section');
assert(html.includes('Roulette · Dice · Tic-Tac-Toe') || html.includes('GAMES'), 'Games card');
assert(html.includes('ID Generator') && html.includes('PEA Generator') && html.includes('Get Printed'), 'Tools generators');
assert(html.includes('MORE TOOLS') && html.includes('Random Video Chat'), 'More tools retained');

// Videos: no Download in catalog cards
var vidActs = html.match(/var acts='<div class="vid-acts"[\s\S]*?<\/div>';/);
assert(vidActs && vidActs[0].indexOf('Download') < 0, 'Videos catalog has no Download button');
assert(html.includes('Most Viewed') && html.includes('Newest') && html.includes('Trending'), 'Videos sort options');

// Routes: /wall opens feed
assert(/slug==='normal'\|\|slug==='wall'[\s\S]{0,120}setFeedTab\('all'/.test(html) || /allposts[\s\S]{0,80}setFeedTab\('all'/.test(html), 'wall route selects ALL POSTS tab');

// Matcher helpers still work for new filters
function extractFn(name) {
  var re = new RegExp('function ' + name + '\\([\\s\\S]*?\\n    \\}');
  var m = html.match(re);
  if (!m) throw new Error('missing ' + name);
  return m[0] + '\n';
}
var sandbox = {
  detectGameOrigin: function () { return ''; },
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
  wallPostHasMedia: function (p) {
    return !!(p && ((p.images && p.images.length) || p.image));
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
var src =
  extractFn('isWallIdPost') +
  extractFn('isWallPeaPost') +
  extractFn('matchesWallFilter');
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
assert(samples.filter(function (p) { return sandbox.matchesWallFilter(p, 'games'); }).map(function (p) { return p.id; }).indexOf(3) >= 0, 'GAMES filter hits roulette');
assert(samples.filter(function (p) { return sandbox.matchesWallFilter(p, 'id'); }).map(function (p) { return p.id; }).indexOf(4) >= 0, 'ID filter hits id posts');
assert(samples.filter(function (p) { return sandbox.matchesWallFilter(p, 'pea'); }).map(function (p) { return p.id; }).indexOf(5) >= 0, 'PEA filter hits pea posts');
assert(samples.filter(function (p) { return sandbox.matchesWallFilter(p, 'timed'); }).map(function (p) { return p.id; }).indexOf(2) >= 0, 'TIMED filter hits timed posts');
assert(samples.filter(function (p) { return sandbox.matchesWallFilter(p, 'normal'); }).map(function (p) { return p.id; }).indexOf(1) >= 0, 'REGULAR filter hits normal posts');

console.log('\nFeed + Explore unify checks passed');
