#!/usr/bin/env node
/**
 * Public Pin (guest $5 path mirrors Delete) + floating Feed switch
 * (EXTENDED | ALL POSTS fixed above bottom nav; removed from panel chrome).
 */
'use strict';
var fs = require('fs');
var path = require('path');
var root = path.join(__dirname, '..');
var html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
var adminReq = fs.readFileSync(path.join(root, 'api', 'admin-request.js'), 'utf8');

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL · ' + msg);
    process.exit(1);
  }
  console.log('PASS · ' + msg);
}

function fnSlice(name) {
  var re = new RegExp('function ' + name + '\\([\\s\\S]*?\\n    (?:async )?function |function ' + name + '\\([\\s\\S]*?\\n    window\\.' + name);
  var m = html.match(re);
  return m ? m[0] : '';
}

// —— 1) Guest Pin: no login gate on openPinModal ——
var openPin = fnSlice('openPinModal');
assert(openPin.indexOf('ensureAnonIdentity') >= 0, 'openPinModal ensures anon identity for guests');
assert(openPin.indexOf("toast('Login required')") < 0, 'openPinModal no longer hard-blocks with Login required');
assert(openPin.indexOf('Guest session · pay $5 directly') >= 0, 'openPinModal guest $5 messaging');
assert(openPin.indexOf('Coins require a registered account') >= 0, 'openPinModal keeps Coins registered-only');

// —— 2) confirmPinPaid uses stable anon id (Delete pattern) ——
var confirmPin = fnSlice('confirmPinPaid');
assert(confirmPin.indexOf('resolveRemoveRequesterId') >= 0, 'confirmPinPaid resolves anon/requester id');
assert(confirmPin.indexOf("toast('Log in first so admin can identify you.')") < 0, 'confirmPinPaid no longer requires registered login');
assert(confirmPin.indexOf('You already have a pending pin request') >= 0, 'confirmPinPaid blocks duplicate pending claims');
assert(confirmPin.indexOf("kind:'pin_payment_request'") >= 0 || html.indexOf("kind:'pin_payment_request'") >= 0, 'pin creates pin_payment_request');

// —— 3) startPayTicket treats Pin like Delete for guests ——
var payTicket = fnSlice('startPayTicket');
assert(payTicket.indexOf('isRemove||isPin') >= 0 || /isRemove\s*\|\|\s*isPin/.test(payTicket), 'startPayTicket guest path covers Pin');
assert(payTicket.indexOf('resolveRemoveRequesterId') >= 0, 'startPayTicket uses resolveRemoveRequesterId for Pin');

// —— 4) Coins pin still registered-only; price unchanged ——
assert(/pin:\s*10/.test(html) && /delete:\s*10/.test(html), 'Pin and Delete still cost 10 Coins');
assert(html.indexOf('Coins require a registered account. Pay $5 below, or sign in.') >= 0, 'guest coin pin blocked with Delete-style toast');
assert(html.indexOf("kind:'remove_request'") >= 0, 'Delete request path retained');
assert(html.indexOf('function openRemove') >= 0 && html.indexOf('ensureAnonIdentity') >= 0, 'guest Delete path retained');

// —— 5) Admin intake still distinguishes pin vs delete; anon sessions allowed ——
assert(adminReq.indexOf('pin_payment_request') >= 0, 'admin-request allows pin_payment_request');
assert(adminReq.indexOf('remove_request') >= 0, 'admin-request allows remove_request');
assert(/pin_payment_request/.test(adminReq) && /anon_/.test(adminReq), 'admin-request documents anon session for pin/delete');
assert(html.indexOf('asec-pinreq') >= 0 || html.indexOf('renderAdminPins') >= 0, 'admin pin requests panel retained');
assert(html.indexOf('asec-removereq') >= 0 || html.indexOf('renderAdminRemoves') >= 0, 'admin delete requests panel retained');

// —— 6) Feed panel: content-first EXTENDED (Phase 1 — tools moved to Explore) ——
var feedPanel = html.match(/id="panel-feed"[\s\S]*?id="posts-container"/);
assert(!!feedPanel, 'panel-feed block extractable');
var block = feedPanel[0];
var iBanner = block.indexOf('class="banner"');
var iStories = block.indexOf('home-random-strip');
var iGoPublic = block.indexOf('btn-go-public');
var iLegacy = block.indexOf('feed-tools-legacy');
var iRouletteCard = block.indexOf('btn-open-roulette');
var iSearch = block.indexOf('feed-search-wrap');
var iFilters = block.indexOf('feed-gender-filter');
var iSort = block.indexOf('feed-sort-row');
var iPosts = block.indexOf('posts-container');
assert(iBanner >= 0 && iStories >= 0 && iGoPublic >= 0, 'banner · Stories · GO PUBLIC retained');
assert(iLegacy >= 0 && iLegacy < iSearch, 'legacy tool hooks hidden before search');
assert(block.indexOf('exposure-videos-entry') < 0, 'Exposure Videos chrome removed from Feed');
assert(block.indexOf('Generate ID') < 0 && block.indexOf('Get printed') < 0, 'ID/Print chrome removed from Feed');
assert(iRouletteCard < 0, 'no standalone Ruin Roulette Feed card');
assert(block.indexOf('feed-mode-tabs') < 0 && block.indexOf('data-feed-tab') < 0, 'no inline feed tabs inside panel-feed');
assert(iSearch < iFilters && iFilters < iSort && iSort < iPosts, 'search → filters → sort → posts');
assert(html.indexOf('id="feed-float-switch"') >= 0, 'floating feed switch present');
assert(html.indexOf('feed-float-switch') >= 0 && html.indexOf('data-feed-tab="extended"') >= 0 && html.indexOf('data-feed-tab="all"') >= 0, 'both feed tabs on floating switch');
assert((html.match(/id="feed-float-switch"/g) || []).length === 1, 'exactly one floating feed switch');
assert(/linear-gradient\(90deg,#7c3aed,#ff6a00\)/.test(html), 'feed tab active gradient retained');
assert(html.indexOf('btn-explore-games') >= 0 && html.indexOf('Triki · Dados · Ruin Roulette') >= 0, 'Games live in Explore PLAY');

// —— 7) Extended vs All Posts independence retained ——
assert(html.indexOf('function openFeedExtended') >= 0 && html.indexOf('function openFeedAllPosts') >= 0, 'tab switch helpers retained');
assert(html.indexOf('function syncFeedFloatVisibility') >= 0, 'floating switch visibility sync');
assert(html.indexOf('id="feed-search"') >= 0 && html.indexOf('id="wall-search"') >= 0, 'separate search inputs');
assert(html.indexOf('Newest') >= 0 && html.indexOf('Most Time') >= 0 && html.indexOf('Ending Soon') >= 0, 'Extended sort chips');
assert(html.indexOf('Most Recent') >= 0 && html.indexOf('Most Interaction') >= 0, 'All Posts sort chips');

console.log('\nOK · public-pin-feed-tabs');
