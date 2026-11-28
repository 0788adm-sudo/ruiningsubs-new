#!/usr/bin/env node
'use strict';
/**
 * Feed / Explore / Topics / Videos reorganization guards (v3).
 * FEED owns EXTENDED + ALL POSTS tabs; Explore is discovery; Videos ≠ GoonTok.
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

// —— Bottom nav: five destinations ——
assert(/data-p="feed"[\s\S]{0,400}Feed/.test(html), 'nav Feed');
assert(/data-p="goontok"[\s\S]*?GoonTok/.test(html), 'nav GoonTok');
assert(/data-p="post"[\s\S]*?CREATE/.test(html), 'nav Create');
assert(/data-p="explore"[\s\S]*?Explore/.test(html), 'nav Explore');
assert(/data-p="profile"[\s\S]*?Profile/.test(html), 'nav Profile');
assert(!/data-p="wall"[\s\S]*?All Posts/.test(html.slice(html.indexOf('class="nav-row"'), html.indexOf('class="nav-row"') + 2500)), 'All Posts not a bottom-nav item');
assert((html.match(/class="nav-item/g) || []).length >= 4, 'four side nav items + center create');

// —— FEED tabs (floating switch) ——
assert(html.includes('id="feed-float-switch"'), 'floating feed switch');
assert(html.includes('data-feed-tab="extended"') && html.includes('>EXTENDED<'), 'EXTENDED tab');
assert(html.includes('data-feed-tab="all"') && html.includes('>ALL POSTS<'), 'ALL POSTS tab');
assert(html.includes('function openFeedAllPosts') && html.includes('function openFeedExtended'), 'feed tab helpers');
assert(html.includes('function syncFeedFloatVisibility'), 'floating visibility helper');
assert(html.includes("localStorage.setItem('rs_feed_tab'"), 'feed tab persistence');
assert((html.match(/id="feed-float-switch"/g) || []).length === 1, 'exactly one feed switch');

// —— All Posts primary filters (exactly 5: ID+PEA unified) ——
var wallBar = html.slice(html.indexOf('id="wall-filter-bar"'), html.indexOf('id="wall-filter-bar"') + 1600);
assert(wallBar.includes('data-wall-filter="all"') && wallBar.includes('>ALL<'), 'ALL filter');
assert(wallBar.includes('data-wall-filter="tasks"') && wallBar.includes('>GAMES<'), 'GAMES filter');
assert(wallBar.includes('data-wall-filter="id_pea"') && wallBar.includes('>ID / PEA<'), 'unified ID / PEA filter');
assert(!wallBar.includes('data-wall-filter="id"') && !wallBar.includes('data-wall-filter="pea"'), 'separate ID/PEA chips removed');
assert(wallBar.includes('data-wall-filter="normal"') && wallBar.includes('>REGULAR POSTS<'), 'REGULAR POSTS filter');
assert(wallBar.includes('data-wall-filter="timed"') && wallBar.includes('>TIMED POSTS<'), 'TIMED POSTS filter');
assert((wallBar.match(/data-wall-filter="/g) || []).length === 5, 'exactly 5 primary All Posts filters');
assert(html.includes("allowed=['all','tasks','id_pea','normal','timed']"), 'setWallFilter allowlist v4');
assert(html.includes('rs_wall_filters_v4'), 'filters v4 migration flag');
assert(html.includes('Most Recent') && html.includes('Most Interaction'), 'sort retained');
assert(html.includes('id="wall-search"'), 'All Posts search');

// —— Topics on Explore (not primary All Posts) ——
assert(html.includes('id="explore-topics-panel"'), 'Topics panel on Explore');
assert(html.includes('TRENDING TOPICS'), 'Trending Topics label');
assert(!html.includes('POPULAR TOPICS') && !html.includes('RECENT TOPICS') && !html.includes('VIEW ALL TOPICS'), 'legacy topic discovery modes removed');
assert(!html.includes('id="explore-topics-search"'), 'Explore topic search removed');
assert(html.includes('function trendingTopicStats') && html.includes('trendingTopicStats(6)'), 'top-6 live topic frequencies');
assert(html.includes('function openTopicInAllPosts'), 'topic opens All Posts');
assert(html.includes('__wallTopicFilter'), 'topic filter state');
assert(html.includes('function openCommunity'), 'topic feed retained');
var wallSlice = html.slice(html.indexOf('id="panel-wall"'), html.indexOf('id="panel-extended"'));
assert(wallSlice.includes('style="display:none"') || /id="wall-topics"[\s\S]*?display:none/.test(wallSlice), 'Topics block hidden on All Posts');

// —— Explore hub ——
assert(html.includes('class="explore-title">EXPLORE<'), 'Explore title');
assert(html.includes('Search users, content or topics'), 'Explore search placeholder');
assert(!html.includes('btn-explore-allposts') && !html.includes('explore-allposts-card'), 'ALL POSTS explore card removed');
assert(!html.includes('Discover all community publications'), 'ALL POSTS explore subtitle removed');
assert(html.includes('btn-explore-coins-promo') && html.includes('explore-coins-promo'), 'Coins promo explore card');
assert(html.includes('UNLOCK 6 ACTIONS') && html.includes('60 COINS') && /\$5\s*USD/.test(html), 'Coins promo offer copy');
assert(html.includes('Delete · Pin · Unlock Games'), 'Coins promo actions hint');
assert(/id="btn-explore-coins-promo"[^>]*onclick="openCoinShop\(\)"/.test(html), 'Coins promo opens existing shop');
assert(html.includes('function openFeedAllPosts') && html.includes('data-feed-tab="all"'), 'ALL POSTS retained on Feed');
assert(html.includes('btn-explore-trending') && html.includes('openExploreTrending'), 'Trending card');
assert(!html.includes('btn-explore-map-card') && !html.includes('explore-card-map'), 'duplicate Explore map promo card removed');
assert(html.includes('explore-map-card') && html.includes('Open Map') && html.includes('openExposureMap'), 'Exposure Map world preview retained');
assert(html.includes('btn-explore-browse-all') && html.includes('openFeedAllPosts'), 'soft Browse All Posts link in Explore');
assert(!/explore-allposts-card/.test(html), 'no hero ALL POSTS card competing with Feed tabs');
// Phase 1: tools live in Explore — Feed no longer surfaces Map/ID/Print/Games/Videos chrome
var feedChrome = html.slice(html.indexOf('id="panel-feed"'), html.indexOf('id="posts-container"'));
assert(feedChrome.indexOf('feed-tools-legacy') >= 0, 'legacy Feed tool hooks hidden');
assert(!/EXPOSURE MAP[\s\S]{0,80}Discover users around the world/.test(feedChrome), 'Feed Exposure Map chrome removed');
assert(feedChrome.indexOf('Generate ID') < 0 && feedChrome.indexOf('Get printed') < 0, 'Feed ID/Print chrome removed');
assert(feedChrome.indexOf('exposure-videos-entry') < 0, 'Feed Exposure Videos chrome removed');
assert(html.includes('explore-games-card') && html.includes('openChallengesHub'), 'Games card');
assert(html.includes('btn-explore-roulette') && html.includes('btn-explore-dice') && html.includes('btn-explore-triki'), 'Explore PLAY quick chips');
assert(html.includes('btn-explore-idcard') && html.includes('btn-explore-pea'), 'ID/PEA tools');
assert(html.includes('btn-explore-print') && html.includes('btn-explore-randomcam'), 'Print + RandomCam');
assert(html.includes('btn-explore-goontok') && html.includes('btn-explore-videos'), 'GoonTok + Videos tools');
assert(html.includes('id="home-random-strip"') && html.includes('btn-go-public') && html.includes('id="featured-slot"'), 'EXTENDED keeps Stories · GO PUBLIC · Spotlight');

// —— Videos catalog (not GoonTok) ——
assert(html.includes('vid-catalog') && html.includes('videos-catalog-sub'), 'Videos catalog markup');
assert(html.includes("setVideoFilter('views')") && html.includes('Most Viewed'), 'Most Viewed sort');
assert(html.includes("setVideoFilter('new')") && html.includes('Newest'), 'Newest sort');
assert(html.includes("setVideoFilter('trending')") && html.includes('Trending'), 'Trending sort');
assert(html.includes('Browse · search · discover · not GoonTok'), 'Videos vs GoonTok distinction');
assert(html.includes('vid-catalog-card'), 'catalog card class');
assert(!/vid-catalog-card[\s\S]{0,1200}downloadPost/.test(html), 'catalog card has no downloadPost');
assert(!/⬇️ Download/.test(html.slice(html.indexOf('function videoCard'), html.indexOf('function _videoCardOldUnused'))), 'Download removed from videoCard');
assert(html.includes('id="panel-goontok"') && html.includes('gt-scroller'), 'GoonTok panel unchanged');

// —— Extended preserved ——
assert(html.includes('id="panel-feed"') && html.includes('EXTENDED'), 'Extended feed present');
assert(html.includes('function openExtend') || html.includes('openExtend('), 'Extend interactions retained');
assert(fs.existsSync(path.join(__dirname, '..', 'api/extend.js')), 'extend API file intact');

// —— Logic: filters ——
function extractFn(name) {
  var re = new RegExp('function ' + name + '\\([\\s\\S]*?\\n    \\}\\n');
  var m = html.match(re);
  if (!m) throw new Error('missing ' + name);
  return m[0];
}
var sandbox = {
  detectGameOrigin: function (p) {
    var tg = (p && p.tags) || [];
    for (var i = 0; i < tg.length; i++) {
      if (String(tg[i]).indexOf('game_origin:') === 0) return String(tg[i]).slice('game_origin:'.length);
    }
    if (tg.indexOf('roulette') >= 0) return 'roulette';
    if (tg.indexOf('dice') >= 0 || tg.indexOf('exposure_dice') >= 0) return 'dice';
    if (tg.indexOf('tic_tac_toe') >= 0) return 'tic_tac_toe';
    return '';
  },
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
  console: console,
  window: {},
  Date: Date
};
var src =
  extractFn('isRouletteWallPost') +
  extractFn('isGameTaskWallPost') +
  extractFn('isPeaPost') +
  extractFn('isIdPost') +
  'function isWallTimedPost(p){if(!p)return false;if(typeof isPeaOrIdPost===\'function\'&&isPeaOrIdPost(p))return false;if(typeof isVideoPost===\'function\'&&isVideoPost(p))return false;var exp=Number(p.expires||0);if(!exp||!isFinite(exp))return false;var now=Date.now();return exp>now&&exp<=now+60*24*3600*1000;}\n' +
  'function isWallTextPost(p){if(!p)return false;if(isPeaOrIdPost(p))return false;if(isGameTaskWallPost(p))return false;if(isWallTimedPost(p))return false;if(!isTimelessWallPost(p))return false;return !wallPostHasMedia(p);}\n' +
  'function isWallNormalPost(p){if(!p)return false;if(isPeaOrIdPost(p))return false;if(isGameTaskWallPost(p))return false;if(isRouletteWallPost(p))return false;if(isWallTimedPost(p))return false;return isTimelessWallPost(p);}\n' +
  'function isWallNativePost(p){if(!p)return false;if(isPeaOrIdPost(p))return true;if(isGameTaskWallPost(p))return true;var tg=p.tags||[];if(tg.indexOf(\'normal_feed\')>=0||tg.indexOf(\'profile_gallery\')>=0)return true;if(tg.indexOf(\'roulette\')>=0||tg.indexOf(\'dice\')>=0||tg.indexOf(\'tic_tac_toe\')>=0)return true;if(isVideoPost(p))return false;if(tg.indexOf(\'video\')>=0||tg.indexOf(\'goontok\')>=0)return false;return true;}\n' +
  extractFn('isWallUnifiedPost') +
  extractFn('matchesWallFilter');
sandbox.wallFilter = 'all';
vm.createContext(sandbox);
vm.runInContext(src, sandbox);

var now = Date.now();
var samples = [
  { id: 1, title: 'Wall photo', tags: ['normal_feed'], created: now, expires: 0, images: ['a.jpg'], user: 'a' },
  { id: 2, title: 'Extend me', tags: ['exposed', 'ext_360'], created: now - 1000, expires: now + 3600000, images: ['b.jpg'], user: 'b' },
  { id: 3, title: 'Roulette proof', tags: ['roulette', 'game_origin:roulette'], created: now - 2000, expires: 0, images: ['c.jpg'], user: 'c' },
  { id: 4, title: 'Dice proof', tags: ['dice', 'exposure_dice', 'game_origin:dice'], created: now - 3000, expires: 0, images: ['d.jpg'], user: 'd' },
  { id: 5, title: 'Published ID', tags: ['generated_id', 'idcard'], created: now - 4000, expires: 0, images: ['e.jpg'], user: 'e' },
  { id: 6, title: 'Published PEA', tags: ['generated_pea', 'pea'], created: now - 5000, expires: 0, images: ['f.jpg'], user: 'f' },
  { id: 9, title: 'GoonTok clip', tags: ['goontok', 'video'], created: now - 8000, expires: 0, images: ['v.mp4'], user: 'i', _kind: 'video' }
];

assert(sandbox.matchesWallFilter(samples[0], 'all') && sandbox.matchesWallFilter(samples[1], 'all') && sandbox.matchesWallFilter(samples[2], 'all'), 'All includes post+timed+game');
assert(sandbox.matchesWallFilter(samples[0], 'normal') && !sandbox.matchesWallFilter(samples[2], 'normal') && !sandbox.matchesWallFilter(samples[1], 'normal'), 'REGULAR POSTS excludes games/timed');
assert(!sandbox.matchesWallFilter(samples[4], 'normal') && !sandbox.matchesWallFilter(samples[5], 'normal'), 'REGULAR POSTS excludes ID/PEA');
assert(sandbox.matchesWallFilter(samples[2], 'tasks') && sandbox.matchesWallFilter(samples[3], 'tasks') && !sandbox.matchesWallFilter(samples[0], 'tasks'), 'GAMES filter only game proofs');
assert(sandbox.matchesWallFilter(samples[1], 'timed') && !sandbox.matchesWallFilter(samples[0], 'timed'), 'TIMED POSTS only timed');
assert(sandbox.matchesWallFilter(samples[4], 'id_pea') && sandbox.matchesWallFilter(samples[5], 'id_pea'), 'unified ID / PEA filter includes both');
assert(sandbox.isIdPost(samples[4]) && sandbox.isPeaPost(samples[5]), 'original ID vs PEA tags still distinguishable');
assert(!sandbox.matchesWallFilter(samples[0], 'id_pea') && !sandbox.matchesWallFilter(samples[1], 'id_pea'), 'unified filter excludes regular/timed');
assert(!sandbox.matchesWallFilter(samples[6], 'all'), 'All excludes GoonTok catalog');

console.log('\nExplore / All Posts / Topics / Videos reorg checks passed');
