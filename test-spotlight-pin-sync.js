#!/usr/bin/env node
/**
 * Spotlight / pinned posts — timer + feed dedupe unit checks.
 */
'use strict';

var fs = require('fs');
var path = require('path');
var html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg || 'assertion failed');
    process.exit(1);
  }
}

function extractFn(name) {
  var re = new RegExp('function\\s+' + name + '\\s*\\(');
  var m = re.exec(html);
  assert(m, 'missing function ' + name);
  var start = m.index;
  var i = html.indexOf('{', start);
  var depth = 0;
  for (; i < html.length; i++) {
    var ch = html[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return html.slice(start, i + 1);
    }
  }
  throw new Error('unclosed function ' + name);
}

var ctx = {
  posts: [],
  normalFeedPosts: [],
  localFeatured: {},
  featuredSnaps: {},
  window: { __pinBoard: [] }
};

var api = new Function(
  'ctx',
  extractFn('getPinUntil') + '\n' +
  extractFn('hydratePinnedPost') + '\n' +
  extractFn('isNearDupPost') + '\n' +
  'var posts=ctx.posts, normalFeedPosts=ctx.normalFeedPosts, window=ctx.window;\n' +
  'function isDeletedId(){return false}\n' +
  'function isBlockedPinContent(){return false}\n' +
  'function getLocalFeatured(){return ctx.localFeatured}\n' +
  'function getFeaturedSnaps(){return ctx.featuredSnaps}\n' +
  'function findPostAnywhere(id){\n' +
  '  id=String(id);\n' +
  '  return (ctx.posts||[]).find(function(p){return String(p.id)===id})\n' +
  '    || (ctx.normalFeedPosts||[]).find(function(p){return String(p.id)===id})\n' +
  '    || null;\n' +
  '}\n' +
  // re-bind after helper defs so closures see live ctx via getters in helpers above
  'return {\n' +
  '  getPinUntil:function(x){posts=ctx.posts;normalFeedPosts=ctx.normalFeedPosts;window=ctx.window;return getPinUntil(x)},\n' +
  '  hydratePinnedPost:function(x){posts=ctx.posts;normalFeedPosts=ctx.normalFeedPosts;window=ctx.window;return hydratePinnedPost(x)},\n' +
  '  isNearDupPost:isNearDupPost\n' +
  '};'
)(ctx);

var getPinUntil = api.getPinUntil;
var hydratePinnedPost = api.hydratePinnedPost;
var isNearDupPost = api.isNearDupPost;

var now = Date.now();
var pinUntil = now + 48 * 3600 * 1000;
var liveExp = now + 6 * 3600 * 1000;

ctx.localFeatured['42'] = pinUntil;
ctx.featuredSnaps['42'] = { featuredUntil: pinUntil - 1000, expires: liveExp };
ctx.window.__pinBoard = [{ id: 42, featuredUntil: pinUntil - 5000 }];
var until = getPinUntil({ id: 42, featuredUntil: pinUntil - 9000 });
assert(until === pinUntil, 'getPinUntil should take max across sources, got ' + until);

ctx.posts = [{ id: 42, user: 'alice', title: 'Exposed', expires: liveExp, featuredUntil: 0, views: 9 }];
var stub = { id: '42', user: 'alice', title: 'Pinned', featuredUntil: pinUntil, expires: 0 };
var hydrated = hydratePinnedPost(stub);
assert(Number(hydrated.expires) === liveExp, 'hydrate should merge live expires, got ' + hydrated.expires);
assert(Number(hydrated.featuredUntil) === pinUntil, 'hydrate should keep pin until');

var featuredList = [{ p: hydrated, fu: pinUntil }];
var featIds = {};
featuredList.forEach(function (item) { featIds[String(item.p.id)] = 1; });
var list = [
  { id: 42, user: 'alice', title: 'Exposed', expires: liveExp, created: now },
  { id: '99', user: 'bob', title: 'Other', expires: liveExp, created: now }
];
var rest = list.filter(function (p) {
  if (featIds[String(p.id)]) return false;
  if (featuredList.some(function (item) { return isNearDupPost(item.p, p); })) return false;
  return true;
});
assert(rest.length === 1 && String(rest[0].id) === '99', 'Spotlight post must be excluded from feed');

ctx.posts = [];
var pinOnly = hydratePinnedPost({ id: '7', featuredUntil: pinUntil, expires: 0, user: 'x', title: 'Wall' });
var hasExposure = Number(pinOnly.expires || 0) > Date.now();
var isPin = getPinUntil(pinOnly) > Date.now();
var timerExp = hasExposure ? Number(pinOnly.expires) : (isPin ? getPinUntil(pinOnly) : 0);
assert(!hasExposure, 'pin-only stub has no exposure');
assert(isPin, 'pin-only stub is pinned');
assert(timerExp === pinUntil, 'card timer should use pin until when expires is 0');

assert(html.indexOf('data-pin-exp') >= 0, 'Spotlight labels need data-pin-exp');
assert(html.indexOf('__pinExpiryRefreshing') >= 0, 'updateTimers must re-render on pin expiry');
assert(/featIds\[String\(item\.p\.id\)\]/.test(html), 'featIds must use String(id)');
assert(html.indexOf('var snapExp=Number(snap.expires)') >= 0, 'adminPin must include expires in pin-board payload');

console.log('test-spotlight-pin-sync: OK');
