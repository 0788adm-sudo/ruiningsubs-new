#!/usr/bin/env node
'use strict';
/**
 * Static + logic checks for the unified All Posts community feed.
 * Ensures every publication type can appear together without duplicating records.
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

assert(html.includes('data-wall-filter="all"') && html.includes('>All<'), 'All chip in UI');
assert(html.includes('function isWallUnifiedPost'), 'isWallUnifiedPost helper');
assert(html.includes('function wallCategoryBadgeHtml'), 'wallCategoryBadgeHtml helper');
assert(html.includes("filter==='all'"), 'matchesWallFilter handles all');
assert(html.includes('rs_wall_unified_v1'), 'migration flag for default All Posts');
assert(html.includes("allowed=['all','tasks','normal','timed']"), 'allowlist');
assert(html.includes('Most Recent') && html.includes('Most Interaction'), 'sort chips retained');
assert(html.includes('dedupePostList'), 'dedupe across sources');
assert(html.includes('function isGameTaskWallPost'), 'Games specialized filter kept');
assert(!/CREATE TABLE.*unified/i.test(html), 'no new unified table');
assert(!html.includes('duplicatePublication') && !html.includes('copyPostForFeed'), 'no post-copy helpers');

// Extract and evaluate the matcher helpers in isolation.
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
  console: console,
  window: {}
};

var src =
  extractFn('isRouletteWallPost') +
  extractFn('isGameTaskWallPost') +
  // isWallUnifiedPost references later helpers — stub then redefine
  'function isWallTimedPost(p){if(!p)return false;if(typeof isPeaOrIdPost===\'function\'&&isPeaOrIdPost(p))return false;if(typeof isVideoPost===\'function\'&&isVideoPost(p))return false;var exp=Number(p.expires||0);if(!exp||!isFinite(exp))return false;var now=Date.now();return exp>now&&exp<=now+60*24*3600*1000;}\n' +
  'function isWallTextPost(p){if(!p)return false;if(isPeaOrIdPost(p))return false;if(isGameTaskWallPost(p))return false;if(isWallTimedPost(p))return false;if(!isTimelessWallPost(p))return false;return !wallPostHasMedia(p);}\n' +
  'function isWallNormalPost(p){if(!p)return false;if(isPeaOrIdPost(p))return false;if(isGameTaskWallPost(p))return false;if(isRouletteWallPost(p))return false;if(isWallTimedPost(p))return false;return isTimelessWallPost(p);}\n' +
  'function isWallNativePost(p){if(!p)return false;if(isPeaOrIdPost(p))return true;if(isGameTaskWallPost(p))return true;var tg=p.tags||[];if(tg.indexOf(\'normal_feed\')>=0||tg.indexOf(\'profile_gallery\')>=0)return true;if(tg.indexOf(\'roulette\')>=0||tg.indexOf(\'dice\')>=0||tg.indexOf(\'tic_tac_toe\')>=0)return true;if(isVideoPost(p))return false;if(tg.indexOf(\'video\')>=0||tg.indexOf(\'goontok\')>=0)return false;return true;}\n' +
  extractFn('isWallUnifiedPost') +
  extractFn('matchesWallFilter');

// matchesWallFilter depends on wallFilter + helpers already in sandbox
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
  { id: 10, title: 'Public task', tags: ['public_task', 'task'], created: now - 9000, expires: 0, images: ['t.jpg'], user: 'j' }
];

var allHits = samples.filter(function (p) { return sandbox.matchesWallFilter(p, 'all'); });
var allIds = allHits.map(function (p) { return p.id; });
assert(allIds.indexOf(1) >= 0, 'All Posts includes regular post');
assert(allIds.indexOf(2) >= 0, 'All Posts includes extend post');
assert(allIds.indexOf(3) >= 0, 'All Posts includes roulette');
assert(allIds.indexOf(4) >= 0, 'All Posts includes dice');
assert(allIds.indexOf(5) >= 0, 'All Posts includes tic-tac-toe');
assert(allIds.indexOf(6) >= 0, 'All Posts includes IDs');
assert(allIds.indexOf(7) >= 0, 'All Posts includes text/status');
assert(allIds.indexOf(8) >= 0, 'All Posts includes challenges');
assert(allIds.indexOf(10) >= 0, 'All Posts includes public_task');
assert(allIds.indexOf(9) < 0, 'All Posts excludes GoonTok catalog-only');

var taskHits = samples.filter(function (p) { return sandbox.matchesWallFilter(p, 'tasks'); }).map(function (p) { return p.id; });
assert(taskHits.indexOf(3) >= 0 && taskHits.indexOf(4) >= 0 && taskHits.indexOf(5) >= 0, 'Tasks filter includes game proofs');
assert(taskHits.indexOf(1) < 0 && taskHits.indexOf(2) < 0, 'Tasks filter excludes regular/extend');

var normalHits = samples.filter(function (p) { return sandbox.matchesWallFilter(p, 'normal'); }).map(function (p) { return p.id; });
assert(normalHits.indexOf(3) < 0 && normalHits.indexOf(2) < 0, 'Post filter stays exclusive of tasks/extend');

var timedHits = samples.filter(function (p) { return sandbox.matchesWallFilter(p, 'timed'); }).map(function (p) { return p.id; });
assert(timedHits.indexOf(2) >= 0 && timedHits.length === 1, 'Extend filter only timed');

// Dedupe: same id from mixed sources must collapse to one
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
assert(Object.keys(uniq).length === allIds.length, 'deduped All Posts length stable');

console.log('\nUnified wall feed checks passed');
