#!/usr/bin/env node
'use strict';
/**
 * Dual living feeds — EXTENDED and ALL POSTS as FEED tabs (not separate nav items).
 * Verifies feed purity, All Posts aggregation, profile history helpers,
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

// —— Navigation: FEED owns both destinations ——
assert(/data-p="feed"[^>]*>[\s\S]*?Feed/.test(html), 'nav destination Feed');
assert(html.includes('id="feed-float-switch"'), 'floating feed switch');
assert(html.includes('data-feed-tab="extended"') && html.includes('data-feed-tab="all"'), 'EXTENDED / ALL POSTS tabs');
assert((html.match(/id="feed-float-switch"/g) || []).length === 1, 'single floating switch instance');
assert(html.includes('aria-label="Feed — Extended and All Posts"'), 'Feed aria label');
assert(html.includes('> EXTENDED<') || html.includes('>EXTENDED<') || /LIVE FEED|EXTENDED/.test(html), 'EXTENDED feed heading');
assert(html.includes('id="panel-wall"') && html.includes('id="wall-search"') && html.includes('id="explore-normal-posts"'), 'All Posts panel present');
assert(html.includes('data-p="profile"'), 'Profile in bottom nav');

// —— Panels still distinct (reuse, not merge-delete) ——
assert(html.includes('id="panel-feed"') && html.includes('id="panel-wall"'), 'separate panel-feed and panel-wall');
assert(html.includes('function isWallUnifiedPost') && html.includes('function renderPosts'), 'distinct feed renderers');
assert(html.includes('function openFeedAllPosts') && html.includes('function openFeedExtended'), 'tab switch helpers');

// —— Specialized destinations retained ——
assert(html.includes('data-wall-filter="tasks"') && html.includes('>GAMES<'), 'Games filter kept');
assert(html.includes('data-wall-filter="timed"') && html.includes('>TIMED POSTS<'), 'Timed filter kept');
assert(html.includes('data-wall-filter="normal"') && html.includes('>REGULAR POSTS<'), 'Regular Posts filter kept');
assert(html.includes('data-wall-filter="id_pea"') && html.includes('>ID / PEA<'), 'unified ID / PEA filter');
assert(html.includes('btn-explore-idcard') && html.includes('btn-explore-pea'), 'IDs / PEA retained in Explore tools');
assert(html.includes('Most Recent') && html.includes('Most Interaction'), 'All Posts sort filters');
assert(html.includes("allowed=['all','tasks','id_pea','normal','timed']"), 'primary filter allowlist');

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
var timed = { id: 2, title: 'Extend me', tags: ['exposed'], created: now, expires: now + 3600000, images: ['b.jpg'], user: 'b' };
var regular = { id: 1, title: 'Wall photo', tags: ['normal_feed'], created: now, expires: 0, images: ['a.jpg'], user: 'a' };
var game = { id: 3, title: 'Roulette', tags: ['roulette', 'game_origin:roulette'], created: now, expires: 0, images: ['c.jpg'], user: 'c' };
var idp = { id: 4, title: 'Published ID', tags: ['generated_id', 'idcard'], created: now, expires: 0, images: ['d.jpg'], user: 'd' };
var pea = { id: 5, title: 'Published PEA', tags: ['generated_pea', 'pea'], created: now, expires: 0, images: ['e.jpg'], user: 'e' };

assert(sandbox.matchesWallFilter(timed, 'timed') && !sandbox.matchesWallFilter(regular, 'timed'), 'timed filter purity');
assert(sandbox.matchesWallFilter(regular, 'normal') && !sandbox.matchesWallFilter(timed, 'normal') && !sandbox.matchesWallFilter(idp, 'normal'), 'regular filter purity');
assert(sandbox.matchesWallFilter(game, 'tasks') && !sandbox.matchesWallFilter(regular, 'tasks'), 'games filter');
assert(sandbox.matchesWallFilter(idp, 'id_pea') && sandbox.matchesWallFilter(pea, 'id_pea'), 'unified ID / PEA filter');
assert(sandbox.isIdPost(idp) && sandbox.isPeaPost(pea), 'ID vs PEA tags still distinguishable');
assert(sandbox.isWallUnifiedPost(timed) && sandbox.isWallUnifiedPost(regular) && sandbox.isWallUnifiedPost(game), 'unified all includes types');

console.log('\nDual feeds (FEED tabs) checks passed');
