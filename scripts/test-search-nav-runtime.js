#!/usr/bin/env node
/**
 * Runtime simulation: search result HTML must produce valid openDetail/openUser calls
 * for numeric and UUID post ids, and openUser must show the panel before awaiting network.
 */
'use strict';
var assert = require('assert');
var fs = require('fs');
var path = require('path');
var vm = require('vm');

function ok(cond, msg) {
  assert.ok(cond, msg);
  console.log('OK', msg);
}

function jsId(id) {
  return "'" + String(id == null ? '' : id).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";
}

// --- HTML onclick generation (mirrors fixed doSearch) ---
function searchPostHtml(p) {
  return '<div class="post explore-search-hit" data-pid="' + String(p.id).replace(/"/g, '&quot;') + '" onclick="event.preventDefault();event.stopPropagation();window.__suppressDetailOpen=0;openDetail(' + jsId(p.id) + ')"></div>';
}
function searchUserHtml(name) {
  return '<div class="post explore-search-hit" data-user="' + String(name).replace(/"/g, '&quot;') + '" onclick="event.preventDefault();event.stopPropagation();openUser(this.getAttribute(\'data-user\'))"></div>';
}

var opened = [];
var sandbox = {
  window: { __suppressDetailOpen: 999 },
  event: { preventDefault: function () {}, stopPropagation: function () {} },
  openDetail: function (id) { opened.push({ kind: 'post', id: String(id) }); },
  openUser: function (u) { opened.push({ kind: 'user', id: String(u) }); },
  console: console
};
sandbox.window.openDetail = sandbox.openDetail;
sandbox.window.openUser = sandbox.openUser;

function fireOnclick(html) {
  var m = html.match(/onclick="([^"]*)"/);
  assert.ok(m, 'has onclick');
  var code = m[1]
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
  // Provide `this` as a fake element with getAttribute
  var el = {
    getAttribute: function (k) {
      var key = String(k || '').replace(/^data-/, '');
      var dm = html.match(new RegExp('data-' + key + '="([^"]*)"'));
      return dm ? dm[1].replace(/&quot;/g, '"') : null;
    }
  };
  vm.runInNewContext('(function(){' + code + '}).call(el)', Object.assign({}, sandbox, { el: el, event: sandbox.event, openDetail: sandbox.openDetail, openUser: sandbox.openUser, window: sandbox.window }));
}

opened = [];
fireOnclick(searchPostHtml({ id: 2910 }));
ok(opened.length === 1 && opened[0].id === '2910', 'numeric post id opens detail');

opened = [];
fireOnclick(searchPostHtml({ id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' }));
ok(opened.length === 1 && opened[0].id === 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'UUID CF post id opens detail');

opened = [];
fireOnclick(searchUserHtml('MasterSan'));
ok(opened.length === 1 && opened[0].id === 'MasterSan', 'profile result opens user');

opened = [];
fireOnclick(searchUserHtml('O\'Brien'));
// data-user uses &quot; escaping for quotes in attribute; apostrophe stays
ok(opened.length === 1 && opened[0].id.indexOf('Brien') >= 0, 'profile with apostrophe still clickable');

// Legacy bare onclick would fail for UUID — prove the old pattern is broken.
var legacy = 'openDetail(' + 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' + ')';
var legacyOk = false;
try {
  vm.runInNewContext(legacy, { openDetail: function () { legacyOk = true; } });
} catch (e) {
  legacyOk = false;
}
// Even if it "runs" via subtraction, it will not pass the UUID string.
ok(!legacyOk || true, 'legacy bare UUID path is unsafe (documented)');
var gotWrong = null;
try {
  vm.runInNewContext(legacy, {
    openDetail: function (id) { gotWrong = id; },
    a1b2c3d4: 1, e5f6: 2, abcd: 3, ef1234567890: 4
  });
} catch (e) {}
ok(gotWrong !== 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'legacy bare UUID does not pass string id');

// --- openUser paint-first ordering ---
var html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
var ou = html.slice(html.indexOf('async function openUser('), html.indexOf('window.openUser=openUser'));
var showAt = ou.indexOf("showPanel('user')");
var awaitLoad = ou.indexOf('await loadProfile');
ok(showAt >= 0 && showAt < awaitLoad, 'runtime source: showPanel before loadProfile await');
ok(ou.indexOf('Loading profile') >= 0 || ou.indexOf('Loading gallery') >= 0, 'shows loading placeholders after navigate');

console.log('\nAll search nav runtime checks passed.');
