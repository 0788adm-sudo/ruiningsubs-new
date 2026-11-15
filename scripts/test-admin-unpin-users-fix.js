#!/usr/bin/env node
/**
 * Guards for admin UNPIN fix, LoserFagg auto-pin disable, users counter,
 * and server-validated delete permissions.
 */
'use strict';
var fs = require('fs');
var path = require('path');
var vm = require('vm');
var root = path.join(__dirname, '..');
var html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
var unpinApi = fs.readFileSync(path.join(root, 'api', 'admin-unpin.js'), 'utf8');
var usersApi = fs.readFileSync(path.join(root, 'api', 'admin-users.js'), 'utf8');
var delApi = fs.readFileSync(path.join(root, 'api', 'delete-post.js'), 'utf8');

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL · ' + msg);
    process.exit(1);
  }
  console.log('PASS · ' + msg);
}

// —— Auto-pin disabled for featured profiles ——
assert(/FEATURED_PROFILE_AUTO_PIN\s*=\s*false/.test(html), 'FEATURED_PROFILE_AUTO_PIN disabled');
assert(/if\s*\(\s*FEATURED_PROFILE_AUTO_PIN\s*\)/.test(html), 'getPinUntil gates auto-pin behind flag');

// —— Admin unpin wiring ——
assert(/\/api\/admin-unpin/.test(html), 'panel calls /api/admin-unpin');
assert(/function adminUnpinFromPanel/.test(html), 'adminUnpinFromPanel present');
assert(/function adminUnpinLoserFaggPins/.test(html), 'LoserFagg bulk unpin helper');
assert(/Unpin @LoserFagg/.test(html), 'admin UI button to unpin LoserFagg');
assert(/adminSbAnonPatchPost/.test(html), 'anon REST patch bypass for RLS no-ops');
assert(/\.select\('id'\)/.test(html) && /db_unpin_no_row|adminSbAnonPatchPost/.test(html), 'pin update verifies returned rows');

assert(/verifyAdminToken|verifyCfAdminToken/.test(unpinApi), 'unpin API verifies CF admin token');
assert(/featured_until:\s*null/.test(unpinApi) && /featured:\s*false/.test(unpinApi), 'unpin clears featured flags');
assert(/__PIN_BOARD__/.test(unpinApi), 'unpin retires pin board');
assert(/preserved:\s*'posts_media_comments_stats'/.test(unpinApi), 'unpin preserves post data');
assert(!/from\('posts'\)\.delete/.test(unpinApi), 'unpin API never deletes posts');

// —— Users counter ——
assert(/\/api\/admin-users/.test(html), 'users panel uses /api/admin-users');
assert(/total registered/.test(html), 'counter distinguishes total registered');
assert(/adminFetchProfilesPage/.test(html), 'paginated lean profiles fetch');
assert(/ADMIN_USERS_PAGE_SIZE\s*=\s*50/.test(html), 'users page size 50');
assert(/else if\(sec==='users'\) await loadAdminUsers/.test(html), 'Users tab loads from DB');
assert(/count=exact|count:\s*'exact'/.test(usersApi), 'users API uses exact DB count');
assert(/verifyAdminToken/.test(usersApi), 'users API requires admin token');
assert(!/select\('\*'\)/.test(usersApi), 'users API does not select *');

// —— Delete permission hardening ——
assert(!/function canDeletePostAsOwner[\s\S]{0,220}isAdmin\(\)/.test(html), 'canDeletePostAsOwner no longer treats admin as owner');
assert(/function canModerateDeletePost/.test(html), 'separate admin moderation helper');
assert(/reason:'moderation'/.test(html) && /allowLocalFallback:false/.test(html), 'admin delete uses moderation + no local fallback');
assert(/requireOwner:true|opts\.requireOwner!==false/.test(html), 'local deletePost requires owner proof');
assert(/verifyCfAdminToken/.test(delApi), 'delete-post accepts CF admin bearer');
assert(/adminCredOk/.test(delApi), 'delete-post requires real admin credential');
assert(/const freeOverride = FREE_REASONS\.has\(reason\) && adminCredOk/.test(delApi), 'moderation delete never trusts body.user alone');
assert(!/freeOverride\s*=\s*FREE_REASONS\.has\(reason\) && \(isAdminUser\(user\)/.test(delApi), 'old isAdminUser-only freeOverride removed');

// —— Unit: getPinUntil must not invent pins for LoserFagg ——
var start = html.indexOf('function getPinUntil(pOrId){');
var end = html.indexOf('function hydratePinnedPost(p){');
assert(start > 0 && end > start, 'getPinUntil bounds');
var chunk =
  'var FEATURED_PROFILES=["loserfagg"];\n' +
  'var FEATURED_PROFILE_AUTO_PIN=false;\n' +
  'var FEATURED_PROFILE_PIN_MS=30*24*3600*1000;\n' +
  'function isFeaturedProfile(name){return FEATURED_PROFILES.indexOf(String(name||"").toLowerCase().replace(/^@/,""))>=0}\n' +
  'function isDeletedId(){return false}\n' +
  'function isBlockedPinContent(){return false}\n' +
  'function getLocalFeatured(){return {}}\n' +
  'function getFeaturedSnaps(){return {}}\n' +
  'var posts=[]; var normalFeedPosts=[]; window={__pinBoard:[]};\n' +
  html.slice(start, end) +
  '\nthis.getPinUntil=getPinUntil;';
var sandbox = { console: console, Date: Date, Math: Math, String: String, Number: Number, Object: Object, Array: Array, JSON: JSON };
vm.createContext(sandbox);
vm.runInContext(chunk, sandbox);
var until = sandbox.getPinUntil({ id: '2343', user: 'LoserFagg', featuredUntil: 0 });
assert(until === 0, 'unit: LoserFagg post without featured_until is not pinned');
var until2 = sandbox.getPinUntil({ id: '2911', user: 'Johnsmith', featuredUntil: Date.now() + 60000 });
assert(until2 > Date.now(), 'unit: real featuredUntil still pins');

console.log('\nAdmin unpin + users + delete permission checks passed');
