#!/usr/bin/env node
'use strict';
/**
 * Restore Publish ID / Publish PEA visibility in ALL POSTS.
 * Guards filter matchers, wall-ids-mode sync, 2-col card classes, and CF save id check.
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

function extractFn(name) {
  var re = new RegExp('function ' + name + '\\([\\s\\S]*?\\n    \\}\\n');
  var m = html.match(re);
  if (!m) throw new Error('missing ' + name);
  return m[0];
}

// —— Static: ID/PEA chips + grid adaptations ——
assert(html.includes('data-wall-filter="id"') && html.includes('data-wall-filter="pea"'), 'ID and PEA filter chips');
assert(html.includes('Most Recent') && html.includes('Most Interaction'), 'sort chips retained');
assert(/#explore-normal-posts\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2/.test(html), '2-column All Posts grid');
assert(html.includes('nf-id-card') && html.includes('nf-pea-card'), 'ID/PEA card classes for grid');
assert(html.includes('article.nf-id-card .normal-feed-post-media') && html.includes('article.nf-pea-card .normal-feed-post-media'), 'ID/PEA contain CSS in 2-col grid');
assert(html.includes("wallFilter==='id'||wallFilter==='pea'"), 'wall-ids-mode sync for id/pea');
assert(!/box\.classList\.toggle\('wall-ids-mode',\s*wallFilter==='generated'\)/.test(html), 'obsolete generated-only wall-ids-mode removed');
assert(html.includes("contains('tags',['generated_id'])") && html.includes("contains('tags',['generated_pea'])"), 'SB tag queries for ID/PEA');
assert(html.includes('Never invent phantom cf_*') || html.includes('phantom local `cf_*`') || html.includes('cfSavedId'), 'CF save requires real id');
assert(html.includes("setWallFilter(isPea?'pea':'id')"), 'publish lands on matching All Posts category');
assert(html.includes("f!=='all' && window.__wallTopicFilter"), 'topic filter cleared on category chips');
assert(html.includes('id="panel-feed"') && html.includes('EXTENDED'), 'EXTENDED preserved');
assert(!/CREATE TABLE/i.test(html.slice(html.indexOf('function idCardShareHere'), html.indexOf('function idCardShareHere') + 4000)), 'publish path does not recreate tables');

// —— Logic: matchers ——
var sandbox = {
  isVideoPost: function (p) {
    var tg = (p && p.tags) || [];
    return tg.indexOf('goontok') >= 0 || tg.indexOf('video') >= 0 || p._kind === 'video';
  },
  detectGameOrigin: function () { return ''; },
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
  extractFn('isPeaOrIdPost') +
  extractFn('isPeaPost') +
  extractFn('isIdPost') +
  extractFn('isRouletteWallPost') +
  extractFn('isGameTaskWallPost') +
  'function isWallTimedPost(p){if(!p)return false;if(typeof isPeaOrIdPost===\'function\'&&isPeaOrIdPost(p))return false;if(typeof isVideoPost===\'function\'&&isVideoPost(p))return false;var exp=Number(p.expires||0);if(!exp||!isFinite(exp))return false;var now=Date.now();return exp>now&&exp<=now+60*24*3600*1000;}\n' +
  'function isWallTextPost(p){if(!p)return false;if(isPeaOrIdPost(p))return false;if(isGameTaskWallPost(p))return false;if(isWallTimedPost(p))return false;if(!isTimelessWallPost(p))return false;return !wallPostHasMedia(p);}\n' +
  'function isWallNormalPost(p){if(!p)return false;if(isPeaOrIdPost(p))return false;if(isGameTaskWallPost(p))return false;if(isRouletteWallPost(p))return false;if(isWallTimedPost(p))return false;return isTimelessWallPost(p);}\n' +
  'function isWallNativePost(p){if(!p)return false;if(isPeaOrIdPost(p))return true;if(isGameTaskWallPost(p))return true;var tg=p.tags||[];if(tg.indexOf(\'normal_feed\')>=0||tg.indexOf(\'profile_gallery\')>=0)return true;if(isVideoPost(p))return false;return true;}\n' +
  extractFn('isWallUnifiedPost') +
  extractFn('matchesWallFilter');

sandbox.wallFilter = 'all';
vm.createContext(sandbox);
vm.runInContext(src, sandbox);

var now = Date.now();
var samples = [
  { id: 1, title: 'Wall photo', tags: ['normal_feed'], created: now, expires: 0, images: ['a.jpg'], user: 'a' },
  { id: 2, title: 'Extend me', tags: ['exposed', 'ext_360'], created: now - 1000, expires: now + 3600000, images: ['b.jpg'], user: 'b' },
  { id: 3, title: 'Published ID', tags: ['generated_id', 'idcard', 'id', 'normal_feed'], created: now - 2000, expires: 0, images: ['c.jpg'], user: 'c' },
  { id: 4, title: 'Published PEA', tags: ['generated_pea', 'pea', 'normal_feed'], created: now - 3000, expires: 0, images: ['d.jpg'], user: 'd' },
  { id: 5, title: 'Legacy ID', tags: ['id', 'profile_gallery'], created: now - 4000, expires: 0, images: ['e.jpg'], user: 'e' },
  { id: 6, title: 'Published ID', tags: ['idcard'], created: now - 5000, expires: 0, images: ['f.jpg'], user: 'f' },
  { id: 7, title: 'GoonTok clip', tags: ['goontok', 'video'], created: now - 6000, expires: 0, images: ['v.mp4'], user: 'g', _kind: 'video' }
];

assert(sandbox.isIdPost(samples[2]) && !sandbox.isPeaPost(samples[2]), 'modern ID tags match ID only');
assert(sandbox.isPeaPost(samples[3]) && !sandbox.isIdPost(samples[3]), 'PEA tags match PEA only');
assert(sandbox.isIdPost(samples[4]), 'legacy bare tag id matches ID filter');
assert(sandbox.isIdPost(samples[5]), 'idcard-only matches ID filter');
assert(sandbox.matchesWallFilter(samples[2], 'id') && sandbox.matchesWallFilter(samples[4], 'id') && sandbox.matchesWallFilter(samples[5], 'id'), 'ID filter includes modern + legacy');
assert(sandbox.matchesWallFilter(samples[3], 'pea') && !sandbox.matchesWallFilter(samples[2], 'pea'), 'PEA filter exclusivity');
assert(!sandbox.matchesWallFilter(samples[2], 'normal') && !sandbox.matchesWallFilter(samples[3], 'normal'), 'REGULAR excludes ID/PEA');
assert(!sandbox.matchesWallFilter(samples[2], 'timed') && !sandbox.matchesWallFilter(samples[3], 'timed'), 'TIMED excludes ID/PEA');
assert(sandbox.matchesWallFilter(samples[2], 'all') && sandbox.matchesWallFilter(samples[3], 'all') && sandbox.matchesWallFilter(samples[4], 'all'), 'ALL includes ID/PEA');
assert(!sandbox.matchesWallFilter(samples[6], 'all'), 'ALL excludes GoonTok catalog');

// Sort helpers still present
assert(html.includes('function wallInteractionScore') && html.includes("wallSortMode==='interaction'"), 'Most Interaction sort retained');
assert(html.includes('function setWallSort'), 'sort setter retained');

console.log('\nID/PEA All Posts restore checks passed');
