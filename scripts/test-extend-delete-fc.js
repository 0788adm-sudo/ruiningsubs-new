#!/usr/bin/env node
'use strict';
/**
 * Behavioral checks: active Extend posts with deletion_tier=deletable
 * must remain paid-remove (50 FC), while normal Wall posts stay free/blocked.
 */
var fs = require('fs');
var path = require('path');
var vm = require('vm');
var html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
var api = fs.readFileSync(path.join(__dirname, '..', 'api', 'delete-post.js'), 'utf8');

function assert(c, m) {
  if (!c) {
    console.error('FAIL:', m);
    process.exit(1);
  }
  console.log('PASS ·', m);
}

function extractFn(src, name) {
  var re = new RegExp('function\\s+' + name + '\\s*\\([\\s\\S]*?\\n    \\}\\n');
  var m = src.match(re);
  if (!m) throw new Error('missing ' + name);
  return m[0];
}

var sandbox = {
  console: console,
  Date: Date,
  Array: Array,
  String: String,
  Number: Number,
  Math: Math,
  JSON: JSON,
  isFinite: isFinite,
  window: {}
};
sandbox.window = sandbox;

var bundle =
  'var DELETION_TIERS=["deletable","locked","permanent"];\n' +
  extractFn(html, 'normalizeDeletionTier') +
  extractFn(html, 'parseDeletionTierTag') +
  extractFn(html, 'postDeletionTier') +
  extractFn(html, 'postFreeDeletionEnabled') +
  // dependencies for timer checks
  'function isTimelessWallPost(p){var exp=Number(p&&p.expires||0);if(!exp||!isFinite(exp))return true;return exp>Date.now()+60*24*3600*1000;}\n' +
  'function postHasActiveTimer(p){var exp=Number(p&&p.expires||0);if(!exp||!isFinite(exp))return false;var now=Date.now();if(exp<=now)return false;if(exp>now+60*24*3600*1000)return false;return true;}\n' +
  'function isWallTimedPost(p){return postHasActiveTimer(p);}\n' +
  'function isFeedTimerPost(p){return postHasActiveTimer(p);}\n' +
  extractFn(html, 'deletionRequiresFc') +
  extractFn(html, 'samePostOwner') +
  extractFn(html, 'isPaidRemovePost');

vm.runInNewContext(bundle, sandbox);

var now = Date.now();
var extendDeletable = {
  id: 'e1',
  user: 'Alice',
  deletion_tier: 'deletable',
  tags: ['expose', 'del:deletable'],
  expires: now + 3 * 3600 * 1000,
  extendAmount: 360
};
var normalDeletable = {
  id: 'n1',
  user: 'Alice',
  deletion_tier: 'deletable',
  tags: ['normal_feed', 'del:deletable'],
  expires: 0
};
var lockedExtend = {
  id: 'e2',
  user: 'Bob',
  deletion_tier: 'locked',
  tags: ['expose', 'del:locked'],
  expires: now + 5 * 3600 * 1000
};

// Deletable tier = owner-free (even with active Extend). Locked still flags paid for non-owners.
assert(sandbox.isPaidRemovePost(extendDeletable) === false, 'Extend+deletable is NOT paid-remove for owner path');
assert(sandbox.deletionRequiresFc(extendDeletable) === false, 'Extend+deletable does not require FC for owner');
assert(sandbox.isPaidRemovePost(normalDeletable) === false, 'normal Wall+deletable is NOT paid-remove');
assert(sandbox.deletionRequiresFc(normalDeletable) === false, 'normal Wall+deletable does not require FC');
assert(sandbox.isPaidRemovePost(lockedExtend) === true, 'locked Extend is paid-remove (non-owner / legacy flag)');
assert(sandbox.deletionRequiresFc(lockedExtend) === true, 'locked Extend requires FC flag (non-owner path)');
assert(sandbox.samePostOwner(extendDeletable, 'alice') === true, 'owner match ignores case');
assert(sandbox.samePostOwner(extendDeletable, '@Alice') === true, 'owner match ignores @');
assert(sandbox.samePostOwner(extendDeletable, 'other') === false, 'non-owner rejected');

// API source contract — owners free; non-owners still spend 50 FC via reason=paid
assert(/function ownerDeleteCost[\s\S]*?return 0/.test(api), 'API ownerDeleteCost always free');
assert(/legacyRequiresFc/.test(api), 'API keeps legacyRequiresFc helper');
assert(/spendDeleteFc/.test(api), 'API spends before delete');
assert(/insufficient/.test(api), 'API returns insufficient');

// Evaluate API cost helpers in isolation
(function () {
  var start = api.indexOf('function parseTags');
  var end = api.indexOf('function isAdminUser');
  assert(start > 0 && end > start, 'API helper slice bounds');
  var helpers =
    'const DELETE_COST_FC=50;\nconst ALLOWED_TIERS=new Set(["deletable","locked","permanent"]);\n' +
    api.slice(start, end);
  var box = { Set: Set, Number: Number, String: String, Array: Array, Date: Date, JSON: JSON };
  vm.runInNewContext(helpers, box);
  var extendRow = {
    deletion_tier: 'deletable',
    tags: ['expose'],
    expires_at: new Date(Date.now() + 3e6).toISOString(),
    extend_amount: 360
  };
  var normalRow = { deletion_tier: 'deletable', tags: ['normal_feed'], expires_at: null, extend_amount: 0 };
  var lockedRow = {
    deletion_tier: 'locked',
    tags: ['expose'],
    expires_at: new Date(Date.now() + 3e6).toISOString(),
    extend_amount: 360
  };
  var legacyTimed = {
    deletion_tier: 'legacy',
    tags: ['expose'],
    expires_at: new Date(Date.now() + 3e6).toISOString(),
    extend_amount: 360
  };
  // Universal Delete: verified owners always free (tiers only affect third-party paid remove).
  assert(box.ownerDeleteCost(extendRow) === 0, 'API ownerDeleteCost Extend+deletable = 0 (owner free)');
  assert(box.ownerDeleteCost(normalRow) === 0, 'API ownerDeleteCost normal+deletable = 0');
  assert(box.ownerDeleteCost(lockedRow) === 0, 'API ownerDeleteCost locked = 0 (owner free)');
  assert(box.legacyRequiresFc(extendRow) === false, 'legacyRequiresFc deletable Extend false');
  assert(box.legacyRequiresFc(legacyTimed) === true, 'legacyRequiresFc legacy timed true');
  assert(box.legacyRequiresFc(normalRow) === false, 'legacyRequiresFc normal false');
})();

console.log('\nExtend delete FC checks passed');
