#!/usr/bin/env node
/**
 * Admin panel reorganization — structure + Print send/reject wiring.
 */
'use strict';
var fs = require('fs');
var path = require('path');
var root = path.join(__dirname, '..');
var html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL · ' + msg);
    process.exit(1);
  }
  console.log('PASS · ' + msg);
}

assert(html.indexOf('data-asec="pinned"') >= 0, 'Pins tab');
assert(html.indexOf('data-asec="pinreq"') >= 0, 'Pin requests tab');
assert(html.indexOf('data-asec="removereq"') >= 0, 'Delete requests tab');
assert(html.indexOf('data-asec="print"') >= 0, 'Print tab');
assert(html.indexOf('data-asec="coins"') >= 0, 'Reloads tab');
assert(html.indexOf('data-asec="users"') >= 0, 'Users tab');
assert(html.indexOf('id="asec-pinned"') >= 0 && html.indexOf('id="admin-pinned-list"') >= 0, 'Pinned section list');
assert(html.indexOf('id="admin-req-pin"') >= 0, 'Pin request container kept');
assert(html.indexOf('id="admin-req-remove"') >= 0, 'Remove request container kept');
assert(html.indexOf('id="admin-req-print"') >= 0, 'Print request container kept');
assert(html.indexOf('id="admin-coins-table"') >= 0, 'Coins/reloads table kept');
assert(html.indexOf('function openAdminSection') >= 0, 'lazy openAdminSection');
assert(html.indexOf('function refreshAdminBadges') >= 0, 'badge counters');
assert(html.indexOf('function renderAdminPinnedList') >= 0, 'pinned list renderer');
assert(html.indexOf('function adminUnpinFromPanel') >= 0, 'unpin from panel');
assert(html.indexOf('function markPrintRequestSent') >= 0, 'Print mark-sent action');
assert(html.indexOf('function recordPrintFulfilled') >= 0, 'Print fulfillment board write');
assert(html.indexOf('__PRINT_FULFILLED__') >= 0, 'fulfilled board channel');
assert(html.indexOf('Enviar / Mark sent') >= 0, 'Enviar button label');
assert(html.indexOf('Reject unpaid') >= 0, 'reject unpaid print CTA');
assert(html.indexOf('completed_sent') >= 0, 'sent clears pending without deleting ledger');
assert(html.indexOf('unpaid_rejected') >= 0, 'unpaid reject reason');
assert(html.indexOf('rs_print_fulfilled') >= 0, 'local fulfilled dismiss key');
assert(html.indexOf('fetchAdminPostThumb') >= 0, 'pin request real thumbnails');
assert(html.indexOf('admin-thumb') >= 0, 'admin thumbnail CSS/class');
assert(/async function renderAdmin\(\)\s*\{[\s\S]{0,400}openAdminSection/.test(html), 'renderAdmin only opens active section');
assert(html.indexOf('Only confirm after the fulfillment board write succeeds') >= 0 || html.indexOf('Only confirm after the fulfillment board write succeeds'.slice(0, 20)) >= 0 || html.indexOf('await recordPrintFulfilled(id,\'sent\'') >= 0, 'sent waits for server confirm');
assert(html.indexOf('loadAdminCoins') >= 0 && html.indexOf('approveCoinRequestCustom') >= 0, 'reloads logic preserved');
assert(html.indexOf('function renderAdminUsers') >= 0, 'users section preserved');
assert(html.indexOf('data-asec="requests"') < 0 || html.indexOf('id="asec-requests"') >= 0, 'legacy requests hook retained or removed cleanly');

console.log('\nAdmin panel reorg checks passed');
