#!/usr/bin/env node
'use strict';
/**
 * Regression: password recovery must not re-open / forceTop / scroll after
 * "Link verified" (that froze iPhone / Telegram / Gmail in-app browsers).
 */
var fs = require('fs');
var path = require('path');
var assert = require('assert');

var root = path.join(__dirname, '..');
var html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

function ok(cond, msg) {
  assert.ok(cond, msg);
  console.log('OK', msg);
}

function sliceFn(name, nextName) {
  var start = html.indexOf('function ' + name + '(');
  assert.ok(start >= 0, name + ' exists');
  var end = nextName ? html.indexOf('function ' + nextName + '(', start + 1) : html.length;
  if (end < 0) end = html.length;
  return html.slice(start, end);
}

ok(html.indexOf('__rs_recovery_ui_ready') >= 0, 'recovery UI ready latch');
ok(html.indexOf('__rs_recovery_auth_bound') >= 0, 'single auth listener guard');
ok(html.indexOf('markRecoveryVerified') >= 0, 'markRecoveryVerified helper');
ok(html.indexOf('ensureRecoveryFormInteractive') >= 0, 'ensureRecoveryFormInteractive helper');
ok(html.indexOf('clearRecoveryModeFlags') >= 0, 'clearRecoveryModeFlags helper');
ok(html.indexOf('rs-recovery-mode') >= 0, 'recovery body class');
ok(html.indexOf('btn-toggle-new-pass') >= 0, 'show/hide new password toggle');
ok(html.indexOf('btn-toggle-new-pass2') >= 0, 'show/hide confirm password toggle');
ok(html.indexOf('bindPasswordToggles') >= 0, 'password toggle binder');

var isRec1 = html.indexOf('function isRecoveryUrl(');
var isRec2 = html.indexOf('function isRecoveryUrl(', isRec1 + 1);
ok(isRec1 >= 0 && isRec2 >= 0, 'both isRecoveryUrl definitions present');
var firstDef = html.slice(isRec1, isRec2);
var secondDef = sliceFn('isRecoveryUrl', 'checkRecoveryHash');
ok(firstDef.indexOf('__rs_recovery===true') < 0, 'first isRecoveryUrl ignores __rs_recovery flag');
ok(secondDef.indexOf('__rs_recovery===true') < 0, 'second isRecoveryUrl ignores __rs_recovery flag');
ok(/Only inspect the URL/.test(firstDef) || firstDef.indexOf('__rs_recovery') < 0,
  'isRecoveryUrl documents URL-only check');

var checkFn = sliceFn('checkRecoveryHash', 'boot');
ok(checkFn.indexOf('__rs_recovery_ui_ready') >= 0, 'checkRecoveryHash bails when UI ready');
ok(checkFn.indexOf('__rs_recovery_session_ok') >= 0, 'checkRecoveryHash bails when session ok');

var openFn = sliceFn('openRecoveryUI', 'adminIsUnlocked');
if (openFn.indexOf('function adminIsUnlocked') < 0) {
  // fallback if admin helper name differs nearby
  openFn = html.slice(html.indexOf('function openRecoveryUI('), html.indexOf('function openRecoveryUI(') + 4500);
}
ok(openFn.indexOf('__rs_recovery_ui_ready') >= 0, 'openRecoveryUI is idempotent when ready');
ok(openFn.indexOf('fromRecovery:true') >= 0 || openFn.indexOf('keepScroll:true') >= 0,
  'openRecoveryUI avoids forceTop scroll thrash');
ok(openFn.indexOf('noScroll:true') >= 0, 'openRecoveryUI uses showAuth noScroll');
ok(openFn.indexOf('markRecoveryVerified') >= 0, 'openRecoveryUI marks verified once');
ok(!/toast\('Set your new password now'\)/.test(openFn) || openFn.indexOf('__rs_recovery_toast_shown') >= 0,
  'recovery toast is gated to once');

var showAuthFn = sliceFn('showAuth', 'isRouletteWallPost');
ok(showAuthFn.indexOf('noScroll') >= 0, 'showAuth supports noScroll');
ok(showAuthFn.indexOf("__rs_recovery") >= 0, 'showAuth skips scroll during recovery');

ok(html.indexOf('opts.fromRecovery') >= 0 || html.indexOf('fromRecovery:true') >= 0,
  'showPanel keepScroll respects recovery');
ok(html.indexOf('!isRegistered()&&!window.__rs_recovery') >= 0,
  'showPanel does not force login over recovery form');

ok(html.indexOf('__rs_recovery_auth_bound') >= 0,
  'duplicate PASSWORD_RECOVERY listener removed');

var saveFn = sliceFn('doSaveNewPassword', 'openRecoveryUI');
ok(saveFn.indexOf('updateUser({password:p1})') >= 0, 'save calls updateUser');
ok(saveFn.indexOf('__rs_saving_pass') >= 0, 'save double-submit guard');
ok(saveFn.indexOf('Passwords do not match') >= 0, 'save validates match');
ok(saveFn.indexOf('Password min 6') >= 0 || saveFn.indexOf('at least 6') >= 0, 'save validates min length');
ok(saveFn.indexOf('clearRecoveryModeFlags') >= 0, 'save clears recovery mode only after success');
ok(saveFn.indexOf('Server did not confirm the password change') >= 0, 'save requires confirmed user');

ok(html.indexOf("if(window.__rs_recovery || window.__rs_recovery_ui_ready) return;") >= 0,
  'Telegram popups suppressed during recovery');

ok((html.match(/onAuthStateChange\(function\(event/g) || []).length === 1,
  'only one onAuthStateChange recovery listener registration site');

console.log('\nAll password-recovery freeze checks passed.');
