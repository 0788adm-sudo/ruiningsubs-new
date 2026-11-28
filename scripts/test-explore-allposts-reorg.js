#!/usr/bin/env node
'use strict';
/**
 * Feed / Explore / Topics / Videos reorganization guards.
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
assert(/data-p="feed"[\s\S]*?Extended/.test(html), 'nav Extended');
assert(/data-p="wall"[\s\S]*?All Posts/.test(html), 'nav All Posts');
assert(/data-p="goontok"[\s\S]*?GoonTok/.test(html), 'nav GoonTok');
assert(/data-p="post"[\s\S]*?CREATE/.test(html), 'nav Create');
assert(/data-p="explore"[\s\S]*?Explore/.test(html), 'nav Explore');
assert((html.match(/class="nav-item/g) || []).length >= 4, 'four side nav items + center create');

// —— All Posts primary filters ——
var wallBar = html.slice(html.indexOf('id="wall-filter-bar"'), html.indexOf('id="wall-filter-bar"') + 1200);
assert(wallBar.includes('data-wall-filter="all"') && wallBar.includes('>All<'), 'All filter');
assert(wallBar.includes('data-wall-filter="normal"') && wallBar.includes('>Posts<'), 'Posts filter');
assert(wallBar.includes('data-wall-filter="tasks"') && wallBar.includes('>Games<'), 'Games filter');
assert(wallBar.includes('data-wall-filter="timed"') && wallBar.includes('>Extended<'), 'Extended filter');
assert((wallBar.match(/data-wall-filter="/g) || []).length === 4, 'exactly 4 primary All Posts filters');
assert(!wallBar.includes('>Dominants<') && !wallBar.includes('IDs / PEA') && !wallBar.includes('>Text<'), 'secondary chips removed from primary bar');
assert(html.includes("allowed=['all','tasks','normal','timed']"), 'setWallFilter allowlist v2');
assert(html.includes('rs_wall_filters_v2'), 'filters v2 migration flag');
assert(html.includes('Most Recent') && html.includes('Most Interaction'), 'sort retained');

// —— Topics on All Posts ——
assert(html.includes('id="wall-topics"'), 'Topics block on All Posts');
assert(html.includes('id="wall-search"'), 'All Posts search');
var wall = html.slice(html.indexOf('id="panel-wall"'), html.indexOf('id="panel-extended"'));
assert(wall.indexOf('id="wall-search"') < wall.indexOf('id="wall-topics"'), 'search above Topics');
assert(wall.indexOf('id="wall-topics"') < wall.indexOf('id="wall-filter-bar"'), 'Topics above filters');
assert(wall.indexOf('id="wall-filter-bar"') < wall.indexOf('id="wall-sort-bar"'), 'filters above sort');
assert(html.includes('function renderWallTopics') && html.includes('function topicStatsList'), 'topic count helpers');
assert(html.includes('function normalizeTopicKey'), 'topic key normalization');
assert(html.includes('Popular') && html.includes('Recent') && html.includes('View All'), 'topic discovery modes');
assert(html.includes('function openCommunity'), 'topic feed retained');

// —— Explore hub (not a feed) ——
assert(html.includes('class="explore-title">EXPLORE<'), 'Explore title');
assert(html.includes('DISCOVER RUINEXPOSE'), 'Explore subtitle');
assert(html.includes('Search users, content or topics'), 'Explore search placeholder');
assert(html.includes('btn-explore-trending') && html.includes('openExploreTrending'), 'Trending card');
assert(html.includes('Exposure Map') && html.includes('openExposureMap'), 'Exposure Map retained');
assert(html.includes('explore-games-card') && html.includes('openChallengesHub'), 'Games card');
assert(html.includes('btn-explore-idcard') && html.includes('btn-explore-pea'), 'ID/PEA tools');
assert(html.includes('btn-explore-print') && html.includes('btn-explore-randomcam'), 'Print + RandomCam');
assert(html.includes('btn-explore-goontok') && html.includes('btn-explore-videos'), 'GoonTok + Videos tools');
assert(!html.includes('$10</b><div style="font-size:12px;color:#f5c518">110 Coins'), 'coin pack grid removed from Explore top');

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
  { id: 9, title: 'GoonTok clip', tags: ['goontok', 'video'], created: now - 8000, expires: 0, images: ['v.mp4'], user: 'i', _kind: 'video' }
];

assert(sandbox.matchesWallFilter(samples[0], 'all') && sandbox.matchesWallFilter(samples[1], 'all') && sandbox.matchesWallFilter(samples[2], 'all'), 'All includes post+extend+game');
assert(sandbox.matchesWallFilter(samples[0], 'normal') && !sandbox.matchesWallFilter(samples[2], 'normal') && !sandbox.matchesWallFilter(samples[1], 'normal'), 'Posts filter excludes games/extend');
assert(sandbox.matchesWallFilter(samples[2], 'tasks') && sandbox.matchesWallFilter(samples[3], 'tasks') && !sandbox.matchesWallFilter(samples[0], 'tasks'), 'Games filter only game proofs');
assert(sandbox.matchesWallFilter(samples[1], 'timed') && !sandbox.matchesWallFilter(samples[0], 'timed'), 'Extended filter only timed');
assert(!sandbox.matchesWallFilter(samples[4], 'all'), 'All excludes GoonTok catalog');

console.log('\nExplore / All Posts / Topics / Videos reorg checks passed');
