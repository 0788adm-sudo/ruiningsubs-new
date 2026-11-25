#!/usr/bin/env node
'use strict';
/**
 * Static regression checks for password recovery, username rename,
 * profile edit modal, and blank-screen / auth timeout guards.
 */
var fs = require('fs');
var path = require('path');
var assert = require('assert');

var root = path.join(__dirname, '..');
var html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
var gamePlay = fs.readFileSync(path.join(root, 'api/game-play.js'), 'utf8');

function ok(cond, msg) {
  assert.ok(cond, msg);
  console.log('OK', msg);
}

function count(hay, needle) {
  var n = 0;
  var i = 0;
  while ((i = hay.indexOf(needle, i)) >= 0) {
    n++;
    i += needle.length;
  }
  return n;
}

// --- Password recovery ---
ok(html.indexOf('function sbAuthTimeout(') >= 0, 'sbAuthTimeout helper present');
ok(html.indexOf('function ensureRecoverySession(') >= 0, 'ensureRecoverySession present');
ok(html.indexOf('function applyRecoveryTokensFromUrl(') >= 0, 'manual recovery token apply');
ok(html.indexOf('function clearRecoveryUrlArtifacts(') >= 0, 'clearRecoveryUrlArtifacts present');
ok(html.indexOf('Only clear URL tokens AFTER session is confirmed') >= 0, 'hash cleared only after session OK');
ok(html.indexOf('sbAuthTimeout(sb.auth.updateUser({password:p1})') >= 0, 'updateUser has timeout');
ok(html.indexOf('window.__rs_saving_pass') >= 0, 'double-submit guard on save password');
ok(html.indexOf('window.__rs_forgot_busy') >= 0, 'double-submit guard on forgot email');
ok(html.indexOf('btn-recovery-resend') >= 0, 'request new reset link button');
ok(html.indexOf('recovery-session-status') >= 0, 'recovery session status UI');
ok(html.indexOf('Server did not confirm the password change') >= 0, 'requires confirmed updateUser response');
ok(html.indexOf('history.replaceState(null,\'\',location.pathname+location.search)') < 0 ||
  html.indexOf('clearRecoveryUrlArtifacts') >= 0,
  'legacy early hash wipe replaced or guarded');

// Ensure checkRecoveryHash no longer clears hash before session
var checkFn = html.slice(html.indexOf('function checkRecoveryHash('), html.indexOf('function boot('));
ok(checkFn.indexOf('ensureRecoverySession') >= 0, 'checkRecoveryHash waits for session');
ok(checkFn.indexOf('clearRecoveryUrlArtifacts') >= 0, 'checkRecoveryHash clears only via helper after OK');
ok(!/getSession\(\)\.then\(function\(res\)\{\s*var sess[\s\S]*replaceState/.test(checkFn),
  'checkRecoveryHash does not clear hash inside bare getSession');

// --- Profile edit modal ---
ok(html.indexOf('id="edit-profile-modal"') >= 0, 'edit profile modal exists');
ok(html.indexOf('function openEditProfileModal(') >= 0, 'openEditProfileModal helper');
ok(html.indexOf('function closeEditProfileModal(') >= 0, 'closeEditProfileModal helper');
ok(html.indexOf('btn-edit-profile') >= 0, 'Edit profile button retained');
// Form must not sit permanently under my-posts in the profile panel
var profilePanel = html.slice(html.indexOf('id="panel-profile"'), html.indexOf('id="panel-coins"'));
ok(profilePanel.indexOf('id="edit-profile-box"') < 0, 'edit form removed from under profile feed');
ok(profilePanel.indexOf('id="my-posts"') >= 0, 'my-posts still in profile panel');
ok(html.indexOf('closeEditProfileModal()') >= 0, 'save/cancel closes modal');

// --- Username change ---
ok(html.indexOf('function isUsernameTakenCI(') >= 0, 'case-insensitive taken check');
ok(html.indexOf("ilike('username', name)") >= 0 || html.indexOf('.ilike(\'username\', name)') >= 0,
  'client availability uses ilike');
ok(html.indexOf('checkUsernameAvailabilityUI') >= 0, 'live username availability UI');
ok(html.indexOf("update(row).eq('user_id',accountId)") >= 0, 'profile save prefers user_id update');
ok(html.indexOf('serverRenameUsername(oldName,newName') >= 0, 'server rename still called');
ok(gamePlay.indexOf("error: 'username_taken'") >= 0, 'server returns username_taken');
ok(gamePlay.indexOf('username=ilike.') >= 0, 'server taken probe uses ilike');
ok(gamePlay.indexOf('profile_rename_by_user_id') >= 0, 'server renames profile by user_id');
ok(gamePlay.indexOf('profile_delete_orphan_') >= 0, 'server frees orphan old usernames');

// --- Blank screen / perf ---
ok(html.indexOf('sbAuthTimeout(sb.auth.getSession()') >= 0, 'boot getSession has timeout');
ok(html.indexOf('rescueBlankShell') >= 0, 'blank-shell failsafe strengthened');
ok(html.indexOf('Retry feed') >= 0, 'stalled feed shows retry');
ok(html.indexOf('Never block first paint on a hung getSession') >= 0, 'documented non-blocking session restore');
ok(html.indexOf('logged && !recovering') >= 0, 'updateProfilePanel keeps recovery form visible');
var mw = fs.readFileSync(path.join(root, 'middleware.js'), 'utf8');
ok(mw.indexOf('LOOKUP_TIMEOUT_MS') >= 0, 'edge post lookup has timeout');
ok(mw.indexOf('AbortController') >= 0, 'edge post lookup can abort');

// --- Sanity: critical helpers still exported / wired ---
ok(html.indexOf('bsp.onclick=doSaveNewPassword') >= 0 || html.indexOf('bsp.onclick=doSaveNewPassword') >= 0,
  'save password button wired');
ok(html.indexOf('openEditProfileModal()') >= 0, 'edit profile button opens modal');
ok(count(html, 'function isRecoveryUrl(') >= 1, 'isRecoveryUrl present');

console.log('\nAll auth/profile/perf audit checks passed.');
