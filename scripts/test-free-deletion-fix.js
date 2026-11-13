#!/usr/bin/env node
/**
 * Free deletion must honor deletion_tier=deletable / free_deletion_enabled
 * even when the post still has an active timer. Owner token proves anon authorship.
 */
'use strict';
var fs = require('fs');
var path = require('path');
var vm = require('vm');
var root = path.join(__dirname, '..');
var html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
var api = fs.readFileSync(path.join(root, 'api', 'delete-post.js'), 'utf8');
var mig = fs.readFileSync(path.join(root, 'migrations', '20261113_free_deletion_owner_token.sql'), 'utf8');

function assert(c, m) {
  if (!c) {
    console.error('FAIL · ' + m);
    process.exit(1);
  }
  console.log('PASS · ' + m);
}

assert(/free_deletion_enabled/.test(mig), 'migration adds free_deletion_enabled');
assert(/owner_token_hash/.test(mig), 'migration adds owner_token_hash');
assert(/function freeDeletionEnabled/.test(api), 'API freeDeletionEnabled helper');
assert(/ownerToken/.test(api) && /hashOwnerToken/.test(api), 'API accepts ownerToken');
assert(/if \(freeDeletionEnabled\(row\) \|\| tier === 'deletable'\) return 0/.test(api), 'API free-exits deletable before timed charge');
assert(!/if \(legacyRequiresFc\(row\)\) return DELETE_COST_FC;\s*if \(tier === 'deletable'\) return 0/.test(api), 'API no longer charges timed before deletable check');

assert(/function postFreeDeletionEnabled/.test(html), 'client postFreeDeletionEnabled');
assert(/function canDeletePostAsOwner/.test(html), 'client canDeletePostAsOwner');
assert(/function persistOwnerDeleteProof/.test(html), 'client persistOwnerDeleteProof');
assert(/rs_owner_tokens/.test(html), 'local owner token store');
assert(/ownerToken:getOwnerToken|body\.ownerToken|ownerToken=/.test(html), 'client sends ownerToken');
assert(/Free deletion is enabled for this post/.test(html), 'openRemove free copy');
assert(/persistOwnerDeleteProof\(row\.id/.test(html), 'publish binds owner proof');

// Extract + unit-test pure helpers.
var start = html.indexOf('var DELETION_TIERS=');
var end = html.indexOf('window.postFreeDeletionEnabled=postFreeDeletionEnabled;');
assert(start > 0 && end > start, 'helper block bounds');
var chunk = html.slice(start, end);
chunk += '\nthis.postDeletionTier=postDeletionTier;this.postFreeDeletionEnabled=postFreeDeletionEnabled;this.deletionRequiresFc=deletionRequiresFc;this.normalizeDeletionTier=normalizeDeletionTier;';
// Provide isPaidRemovePost stub used by deletionRequiresFc for legacy only.
chunk = 'function isPaidRemovePost(p){return !!(p&&p.__legacyPaid);}\n' + chunk;

var sandbox = {
  console: console,
  Math: Math,
  Date: Date,
  Array: Array,
  Object: Object,
  String: String,
  Number: Number,
  JSON: JSON,
  RegExp: RegExp,
  localStorage: {
    _d: {},
    getItem: function (k) { return this._d[k] || null; },
    setItem: function (k, v) { this._d[k] = String(v); }
  },
  window: {},
  currentUser: { name: 'Anon_1234' },
  TextEncoder: typeof TextEncoder !== 'undefined' ? TextEncoder : undefined
};
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(chunk, sandbox);

var freeTimed = {
  id: 1,
  user: 'Anon_1234',
  deletionTier: 'deletable',
  free_deletion_enabled: true,
  expires: Date.now() + 3600000,
  tags: ['exposed', 'del:deletable', 'ext_360']
};
assert(sandbox.postFreeDeletionEnabled(freeTimed) === true, 'unit: free deletion enabled on deletable');
assert(sandbox.deletionRequiresFc(freeTimed) === false, 'unit: deletable timed post does NOT require FC');

var locked = { id: 2, user: 'Anon_1234', deletionTier: 'locked', expires: Date.now() + 3600000, tags: ['del:locked'] };
assert(sandbox.deletionRequiresFc(locked) === true, 'unit: locked still requires FC');

var legacyTimed = { id: 3, user: 'x', deletionTier: 'legacy', __legacyPaid: true, expires: Date.now() + 3600000, tags: ['exposed'] };
assert(sandbox.deletionRequiresFc(legacyTimed) === true, 'unit: legacy timed still requires FC');

console.log('\nFree deletion fix checks passed');
