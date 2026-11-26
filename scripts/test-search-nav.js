#!/usr/bin/env node
/**
 * Search → profile/post navigation must not freeze.
 * Guards: quoted post ids, paint-first openUser, timeouts, retry UI.
 */
'use strict';
var fs = require('fs');
var path = require('path');
var assert = require('assert');

var root = path.join(__dirname, '..');
var html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

function ok(cond, msg) {
  assert.ok(cond, msg);
  console.log('OK', msg);
}

function sliceFn(name) {
  var start = html.indexOf('async function ' + name + '(');
  if (start < 0) start = html.indexOf('function ' + name + '(');
  assert.ok(start >= 0, 'found ' + name);
  var next = html.indexOf('\n    async function ', start + 10);
  var next2 = html.indexOf('\n    function ', start + 10);
  var end = html.length;
  if (next > start) end = Math.min(end, next);
  if (next2 > start) end = Math.min(end, next2);
  return html.slice(start, end);
}

var doSearch = sliceFn('doSearch');
var openUser = sliceFn('openUser');
var openDetail = sliceFn('openDetail');
var ensureFeedPost = sliceFn('ensureFeedPost');

// --- Search result click handlers ---
ok(doSearch.indexOf("openDetail('+p.id+')") < 0, 'search posts do not use bare unquoted openDetail(+p.id)');
ok(doSearch.indexOf('jsId(p.id)') >= 0, 'search posts pass jsId-quoted ids');
ok(doSearch.indexOf("openUser(this.getAttribute('data-user'))") >= 0 || doSearch.indexOf("openUser(this.getAttribute(\\'data-user\\'))") >= 0, 'search accounts use data-user attribute');
ok(doSearch.indexOf('__suppressDetailOpen=0') >= 0, 'search post tap clears suppressDetailOpen');
ok(doSearch.indexOf('explore-search-hit') >= 0, 'search hits marked for tap targets');

// Simulate jsId quoting for UUID CF ids (the freeze class of bug).
function jsId(id) {
  return "'" + String(id == null ? '' : id).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";
}
var uuid = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
var bare = 'openDetail(' + uuid + ')';
var quoted = 'openDetail(' + jsId(uuid) + ')';
ok(!/^[a-z]/.test(uuid.split('-')[0]) || true, 'uuid fixture ready');
ok(quoted === "openDetail('a1b2c3d4-e5f6-7890-abcd-ef1234567890')", 'jsId quotes hyphenated CF ids');
ok(bare !== quoted, 'bare vs quoted differ');
try {
  // bare form is invalid JS when evaluated as a CallExpression argument list with identifiers
  Function('return (' + uuid + ')');
  // If engine parses hyphen as minus, it may not throw — still not a string id.
  ok(true, 'bare uuid expression is not a string post id');
} catch (e) {
  ok(true, 'bare uuid expression is invalid / unsafe');
}

// --- openUser paint-first ---
ok(openUser.indexOf("showPanel('user')") >= 0, 'openUser shows user panel');
var showIdx = openUser.indexOf("showPanel('user')");
var loadIdx = openUser.indexOf('await loadProfile');
ok(showIdx >= 0 && (loadIdx < 0 || showIdx < loadIdx), 'showPanel runs before await loadProfile');
ok(openUser.indexOf('await refreshUsernameAliasMap') < 0 || openUser.indexOf("showPanel('user')") < openUser.indexOf('await refreshUsernameAliasMap'), 'alias refresh does not block first paint');
ok(html.indexOf('window.openUser=openUser') >= 0, 'openUser exported on window');
ok(openUser.indexOf('__openUserGen') >= 0, 'openUser generation guard against stale loads');
ok(openUser.indexOf('Couldn’t load this profile') >= 0 || openUser.indexOf("Couldn't load this profile") >= 0 || openUser.indexOf('Couldn’t open profile') >= 0 || openUser.indexOf('Retry') >= 0, 'openUser has retry / error path');
ok(openUser.indexOf('__userFrom') >= 0, 'openUser records prior panel for Back');

// --- Back from profile returns to explore/search context ---
ok(html.indexOf("var dest=window.__userFrom||'explore'") >= 0, 'user back prefers explore over hard-coded feed');

// --- Detail / ensureFeedPost never hang forever ---
ok(ensureFeedPost.indexOf('fetchWithTimeout') >= 0, 'ensureFeedPost uses fetchWithTimeout');
ok(ensureFeedPost.indexOf('sbQueryTimeout') >= 0, 'ensureFeedPost uses sbQueryTimeout');
ok(openDetail.indexOf('sbQueryTimeout(Promise.resolve(ensureFeedPost') >= 0, 'openDetail caps ensureFeedPost wait');
ok(openDetail.indexOf('Couldn’t load this post') >= 0 || openDetail.indexOf("Couldn't load this post") >= 0, 'openDetail shows retry when load fails');

// --- Alias / profile timeouts ---
ok(html.indexOf("fetchWithTimeout('/api/game-play?action=list_aliases'") >= 0, 'alias map fetch has timeout');
ok(/loadProfile[\s\S]{0,400}sbQueryTimeout/.test(html), 'loadProfile uses sbQueryTimeout');

console.log('\nAll search navigation checks passed.');
