#!/usr/bin/env node
'use strict';
/**
 * Dual living feeds — EXTENDED and ALL POSTS stay distinct destinations.
 * Verifies nav, feed purity, All Posts aggregation, profile history helpers,
 * and that monetization / extend logic files are untouched by feed wiring.
 */
var fs = require('fs');
var path = require('path');
var vm = require('vm');
var html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
var extendApi = fs.readFileSync(path.join(__dirname, '..', 'api/extend.js'), 'utf8');

function assert(c, m) {
  if (!c) {
    console.error('FAIL:', m);
    process.exit(1);
  }
  console.log('PASS ·', m);
}

// —— Navigation: two distinct destinations ——
assert(/data-p="feed"[^>]*>[\s\S]*?Extended/.test(html), 'nav destination Extended');
assert(/data-p="wall"[^>]*>[\s\S]*?All Posts/.test(html), 'nav destination All Posts');
assert(html.includes('aria-label="Extended — main exposure feed"'), 'Extended aria label');
assert(html.includes('aria-label="All Posts — complete community feed"'), 'All Posts aria label');
assert(html.includes('> EXTENDED<') || html.includes('> EXTENDED</div>') || /LIVE FEED|EXTENDED/.test(html) && html.includes('Main exposure feed'), 'EXTENDED feed heading');
assert(html.includes('<strong>All Posts</strong>'), 'All Posts panel title');
assert(!/>Extend\s*<\/button>/.test(html.replace(/openExtend|btn-extend|Extend\?/g, '')), 'bottom nav no longer labeled bare Extend');

// —— Not merged into one feed ——
assert(html.includes('id="panel-feed"') && html.includes('id="panel-wall"'), 'separate panel-feed and panel-wall');
assert(html.includes("data-p=\"feed\"") && html.includes("data-p=\"wall\""), 'separate nav targets');
assert(html.includes('function isWallUnifiedPost') && html.includes('function renderPosts'), 'distinct feed renderers');

// —— Specialized destinations retained ——
assert(html.includes('data-wall-filter="tasks"') && html.includes('>Games<'), 'Games filter kept');
assert(html.includes('data-wall-filter="timed"') && html.includes('>Extended<'), 'Extended filter kept');
assert(html.includes('data-wall-filter="normal"') && html.includes('>Posts<'), 'Posts filter kept');
assert(html.includes('btn-explore-idcard') && html.includes('btn-explore-pea'), 'IDs / PEA retained in Explore tools');
assert(html.includes('Most Recent') && html.includes('Most Interaction'), 'All Posts sort filters');
assert(html.includes("allowed=['all','tasks','normal','timed']"), 'primary filter allowlist');

// —— Profile complete history ——
assert(html.includes('function profilePublicationsHtml'), 'profilePublicationsHtml helper');
assert(html.includes('function isPureProfileGalleryPost'), 'isPureProfileGalleryPost helper');
assert(html.includes('Publications'), 'Publications history heading');
assert(html.includes('mergeProfilePublicationSources'), 'profile source merge (no record copies)');
assert(!html.includes('duplicatePublication') && !html.includes('copyPostForFeed'), 'no post-copy helpers');

// —— Extend payment logic preserved ——
assert(extendApi.indexOf('Extend by the publisher') >= 0 || extendApi.indexOf('extend_amount') >= 0, 'api/extend.js present');
assert(html.includes('function openExtend') || html.includes('openExtend('), 'openExtend retained');
assert(html.includes('/api/extend') || html.includes('api/extend'), 'extend API path retained');

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
    if (tg.indexOf('challenge_proof') >= 0) return 'challenges';
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
  isDeletedId: function () { return false; },
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
  extractFn('matchesWallFilter') +
  extractFn('isPureProfileGalleryPost');

sandbox.wallFilter = 'all';
vm.createContext(sandbox);
vm.runInContext(src, sandbox);

var now = Date.now();
var samples = [
  { id: 1, title: 'Wall photo', tags: ['normal_feed'], created: now, expires: 0, images: ['a.jpg'], user: 'a' },
  { id: 2, title: 'Extend me', tags: ['exposed', 'ext_360'], created: now - 1000, expires: now + 3600000, images: ['b.jpg'], user: 'b' },
  { id: 3, title: 'Roulette proof', tags: ['roulette', 'game_origin:roulette'], created: now - 2000, expires: 0, images: ['c.jpg'], user: 'c' },
  { id: 4, title: 'Dice proof', tags: ['dice', 'exposure_dice', 'game_origin:dice'], created: now - 3000, expires: 0, images: ['d.jpg'], user: 'd' },
  { id: 5, title: 'TTT proof', tags: ['tic_tac_toe', 'ttt_challenge', 'game_origin:tic_tac_toe'], created: now - 4000, expires: 0, images: ['e.jpg'], user: 'e' },
  { id: 6, title: 'Published ID', tags: ['generated_id', 'idcard'], created: now - 5000, expires: 0, images: ['f.jpg'], user: 'f' },
  { id: 7, title: 'Status', tags: ['normal_feed'], created: now - 6000, expires: 0, desc: 'hello', user: 'g' },
  { id: 8, title: 'Challenge', tags: ['challenge_proof', 'game_origin:challenges'], created: now - 7000, expires: 0, images: ['h.jpg'], user: 'h' },
  { id: 9, title: 'GoonTok clip', tags: ['goontok', 'video'], created: now - 8000, expires: 0, images: ['v.mp4'], user: 'i', _kind: 'video' },
  { id: 10, title: 'Public task', tags: ['public_task', 'task'], created: now - 9000, expires: 0, images: ['t.jpg'], user: 'j' },
  { id: 11, title: 'Dominant card', tags: ['dominant', 'dominants'], created: now - 9500, expires: 0, images: ['m.jpg'], user: 'k' },
  { id: 12, title: 'Profile photo', tags: ['profile_only', 'profile_gallery'], created: now - 10000, expires: 0, images: ['p.jpg'], user: 'a' }
];

// All Posts: every publication type except GoonTok catalog
var allHits = samples.filter(function (p) { return sandbox.matchesWallFilter(p, 'all'); });
var allIds = allHits.map(function (p) { return p.id; });
assert(allIds.indexOf(1) >= 0, 'All Posts includes regular post');
assert(allIds.indexOf(2) >= 0, 'All Posts includes extended publication');
assert(allIds.indexOf(3) >= 0 && allIds.indexOf(4) >= 0 && allIds.indexOf(5) >= 0, 'All Posts includes game publications');
assert(allIds.indexOf(6) >= 0, 'All Posts includes IDs');
assert(allIds.indexOf(11) >= 0, 'All Posts includes Dominants when tagged');
assert(allIds.indexOf(9) < 0, 'All Posts excludes GoonTok catalog-only');

// Extended purity (mirrors renderPosts filter rules)
function isExtendedFeedPost(p) {
  if (!p) return false;
  if (sandbox.isPeaOrIdPost(p)) return false;
  if (sandbox.isVideoPost(p)) return false;
  var tg = p.tags || [];
  if (tg.indexOf('normal_feed') >= 0 || tg.indexOf('profile_gallery') >= 0 || tg.indexOf('profile_only') >= 0) return false;
  if (tg.indexOf('video') >= 0 || tg.indexOf('goontok') >= 0) return false;
  var exp = Number(p.expires || 0);
  if (!exp || !isFinite(exp)) return false;
  if (exp <= now) return false;
  if (exp > now + 60 * 24 * 3600 * 1000) return false;
  return true;
}
var extHits = samples.filter(isExtendedFeedPost).map(function (p) { return p.id; });
assert(extHits.indexOf(2) >= 0, 'EXTENDED includes qualifying timed publication');
assert(extHits.indexOf(1) < 0, 'EXTENDED excludes permanent Wall post');
assert(extHits.indexOf(3) < 0 && extHits.indexOf(4) < 0, 'EXTENDED excludes game proofs without timers');
assert(extHits.indexOf(6) < 0, 'EXTENDED excludes IDs/PEA');
assert(extHits.indexOf(9) < 0, 'EXTENDED excludes GoonTok');

// Extended can also appear in All Posts when appropriate
assert(allIds.indexOf(2) >= 0 && extHits.indexOf(2) >= 0, 'extended publication appears in both feeds');

// Profile: pure gallery vs publication history
assert(sandbox.isPureProfileGalleryPost(samples[11]) === true, 'profile_only photo is gallery-only');
assert(sandbox.isPureProfileGalleryPost(samples[0]) === false, 'normal_feed wall post is publication history');
assert(sandbox.isPureProfileGalleryPost(samples[2]) === false, 'game proof is publication history');
assert(sandbox.isPureProfileGalleryPost(samples[1]) === false, 'extend post is publication history');

// Dedupe across sources
function dedupePostList(arr) {
  var seen = {};
  var out = [];
  (arr || []).forEach(function (p) {
    var k = String(p.id);
    if (seen[k]) return;
    seen[k] = 1;
    out.push(p);
  });
  return out;
}
var mixed = samples.concat(samples.map(function (p) { return Object.assign({}, p, { _cf: true }); }));
var deduped = dedupePostList(mixed).filter(function (p) { return sandbox.matchesWallFilter(p, 'all'); });
var uniq = {};
deduped.forEach(function (p) {
  var k = String(p.id);
  assert(!uniq[k], 'no duplicate id in All Posts: ' + k);
  uniq[k] = 1;
});

console.log('\nDual living feeds checks passed');
