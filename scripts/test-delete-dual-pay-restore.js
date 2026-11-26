#!/usr/bin/env node
/**
 * Delete dual-pay restore:
 * - Coins spend deletes immediately
 * - PayPal / Throne / Bitcoin $5 → remove_request (DELETE REQUESTS)
 * - Recharge Coins stays independent (kind:coins)
 * - Anon can claim $5 without registering
 */
'use strict';
var fs = require('fs');
var path = require('path');
var root = path.join(__dirname, '..');
var html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
var adminApi = fs.readFileSync(path.join(root, 'api', 'admin-request.js'), 'utf8');

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL · ' + msg);
    process.exit(1);
  }
  console.log('PASS · ' + msg);
}

assert(html.indexOf('id="remove-modal"') >= 0, 'remove modal present');
assert(html.indexOf('Delete · 10 Coins or $5') >= 0 || html.indexOf("Delete · '+delCost+' Coins or $5'") >= 0, 'title Delete · Coins or $5');
assert(html.indexOf('Delete now — 10 Coins') >= 0, 'Delete now — 10 Coins');
assert(html.indexOf('PayPal $5') >= 0 && html.indexOf('btn-remove-paypal') >= 0, 'PayPal $5');
assert(html.indexOf('Pay $5 on Throne') >= 0 && html.indexOf('btn-remove-throne') >= 0, 'Throne $5');
assert(html.indexOf('Bitcoin payment') >= 0 && html.indexOf('btn-remove-btc') >= 0, 'Bitcoin payment');
assert(html.indexOf('I paid $5 — pending admin verification') >= 0, 'I paid $5 — pending admin verification');
assert(html.indexOf('id="btn-cancel-rm"') >= 0 && /btn-cancel-rm[\s\S]{0,80}>Cancel</.test(html), 'Cancel');

assert(html.indexOf("setRemoveModalExternalPay(true)") >= 0, 'non-owner enables external $5 CTAs');
assert(html.indexOf('function resolveRemoveRequesterId') >= 0, 'stable anon/session requester');
assert(html.indexOf("kind:'remove_request'") >= 0, 'creates remove_request');
assert(html.indexOf('PAYMENT CLAIMED / PENDING') >= 0, 'PAYMENT CLAIMED / PENDING status');
assert(html.indexOf("provider:'paypal'") >= 0 && html.indexOf("provider:'throne'") >= 0, 'tracks paypal/throne provider');
assert(html.indexOf("provider:'bitcoin'") >= 0, 'tracks bitcoin provider');

// Hard separation: delete I paid ≠ coin recharge
assert(html.indexOf('submitRemoveRequest blocked Coins path') >= 0, 'Coins blocked from remove_request');
assert(html.indexOf('confirmCoinPackPaid') >= 0 && /kind:'coins'/.test(html), 'recharge still uses kind coins');
assert(html.indexOf('RECHARGE COINS') >= 0, 'independent RECHARGE COINS modal kept');
assert(html.indexOf('btn-remove-buycoins') >= 0, 'optional Recharge entry from delete modal');

// Must not auto-redirect broke users away from $5 options only into recharge
(function () {
  var m = html.match(/function openRemove\(id\)\{[\s\S]*?\n    function /);
  assert(!!m, 'openRemove extractable');
  var body = m[0];
  assert(body.indexOf("setRemoveModalExternalPay(true)") >= 0, 'openRemove shows external pay');
  assert(body.indexOf('showRemoveModal()') >= 0 || body.indexOf("classList.add('show')") >= 0, 'openRemove shows modal for non-owner');
  // Must not early-return into openNeedCoins before showing $5 CTAs
  assert(!/if\(bal<delCost\)\{\s*try\{openNeedCoins/.test(body), 'no auto-skip to recharge-only when broke');
})();

assert(html.indexOf('function requestDeleteWithCoins') >= 0, 'Coins delete helper');
assert(html.indexOf("spendFagCoins('delete'") >= 0, 'debits Coins via spendFagCoins');
assert(html.indexOf('function approveRemoveReq') >= 0, 'admin approve deletes post');
assert(html.indexOf('function dismissRemoveReq') >= 0, 'admin reject keeps post');
assert(html.indexOf('function clearRemoveReqOnly') >= 0, 'admin clear keeps post');

assert(adminApi.indexOf('remove_request') >= 0, 'admin-request accepts remove_request');
assert(adminApi.indexOf('deletion_payment_requests') >= 0, 'persists deletion_payment_requests');
assert(adminApi.indexOf("status: 'pending'") >= 0, 'server stores pending for manual verify');

console.log('\nOK · delete-dual-pay-restore');
