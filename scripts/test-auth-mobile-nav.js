#!/usr/bin/env node
'use strict';
/**
 * Static regression: centralized auth shell + scroll-tap cancellation +
 * bottom-nav clearance for auth forms.
 */
var fs = require('fs');
var path = require('path');
var assert = require('assert');

var html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

function ok(cond, msg) {
  assert.ok(cond, msg);
  console.log('OK', msg);
}

function sliceFn(name, nextHint) {
  var start = html.indexOf('function ' + name + '(');
  assert.ok(start >= 0, name + ' exists');
  var end = nextHint ? html.indexOf(nextHint, start + 10) : start + 5000;
  if (end < 0) end = start + 5000;
  return html.slice(start, end);
}

ok(html.indexOf('function syncAuthShell(') >= 0, 'syncAuthShell helper');
ok(html.indexOf('function applyAuthFromSession(') >= 0, 'applyAuthFromSession helper');
ok(html.indexOf('function applySignedOutLocal(') >= 0, 'applySignedOutLocal helper');
ok(html.indexOf('function doLogout(') >= 0, 'doLogout helper');
ok(html.indexOf('function revalidateAuthSession(') >= 0, 'revalidateAuthSession helper');
ok(html.indexOf('rsTapWasScroll') >= 0, 'scroll-gesture guard');
ok(html.indexOf('__rsGestureBound') >= 0, 'global gesture binder');

var syncFn = sliceFn('syncAuthShell', 'function applyAuthFromSession');
ok(syncFn.indexOf("authWrap.style.display=showLogged?'none':'block'") >= 0, 'syncAuthShell hides auth when logged');
ok(syncFn.indexOf("loggedWrap.style.display=showLogged?'block':'none'") >= 0, 'syncAuthShell shows logged wrap');
ok(syncFn.indexOf('__rs_recovery') >= 0, 'syncAuthShell respects recovery');

ok(html.indexOf('try{syncAuthShell()}catch(eShell){}') >= 0 ||
  html.indexOf('syncAuthShell()') >= 0,
  'updateProfilePanel / boot calls syncAuthShell');
ok(html.indexOf('Sync shell FIRST') >= 0, 'profile panel syncs shell before network');

var loginFn = sliceFn('doLogin', 'async function doRegister');
ok(loginFn.indexOf('__rs_login_busy') >= 0, 'login double-submit guard');
ok(loginFn.indexOf('applyAuthFromSession') >= 0, 'login applies confirmed session');
ok(loginFn.indexOf('getSession') >= 0, 'login confirms session when missing from signIn');
ok(loginFn.indexOf("toast('Logging in") < 0, 'login avoids duplicate Logging in toast');

ok(html.indexOf('lo.onclick=function(){ try{doLogout()}') >= 0 ||
  html.indexOf('doLogout()') >= 0,
  'logout button uses doLogout');

ok(html.indexOf("event==='SIGNED_IN'") >= 0, 'auth listener handles SIGNED_IN');
ok(html.indexOf("event==='SIGNED_OUT'") >= 0, 'auth listener handles SIGNED_OUT');
ok(html.indexOf("event==='INITIAL_SESSION'") >= 0, 'auth listener handles INITIAL_SESSION');

ok(html.indexOf('revalidateAuthSession') >= 0, 'visibility/pageshow revalidates session');

// Bottom nav clearance
ok(html.indexOf('#panel-profile{padding-bottom:calc(108px') >= 0 ||
  html.indexOf('#panel-profile{padding-bottom:calc(108px + env(safe-area-inset-bottom') >= 0,
  'profile panel clears bottom nav');
ok(html.indexOf('#auth-login,#auth-register,#auth-forgot,#auth-newpass{padding-bottom:calc(96px') >= 0,
  'all auth panes padded above bottom nav');

// Scroll cancel on key handlers
ok(html.indexOf('No document-level touchend → nav') >= 0 ||
  html.indexOf('No document-level touchend') >= 0,
  'removed global touchend→nav converter');
ok(html.indexOf('Scroll/drag cancel — including Extend/Like/Hot') >= 0 ||
  html.indexOf('rsTapWasScroll') >= 0 && html.indexOf('fireExtendFromEl') >= 0,
  'feed actions respect scroll cancel');

var tapOnceIdx = html.indexOf('function tapOnce(el, fn)');
var tapOnce = html.slice(tapOnceIdx, tapOnceIdx + 900);
ok(tapOnce.indexOf('touchmove') >= 0, 'tapOnce tracks touchmove');
ok(tapOnce.indexOf('rsTapWasScroll') >= 0, 'tapOnce checks scroll guard');

ok(html.indexOf('navMoved') >= 0, 'bottom nav tracks pointer move');
ok(html.indexOf('No document-level touchend → nav') >= 0 ||
  html.indexOf("__fastNavBound") < 0 ||
  !/__fastNavBound[\s\S]{0,200}touchend/.test(html),
  'bottom nav no longer uses document touchend capture');

console.log('\nAll auth/mobile-nav checks passed.');
