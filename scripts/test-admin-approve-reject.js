#!/usr/bin/env node
/**
 * Admin Approve/Reject wiring — data-admin delegation + auth re-prompt.
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

assert(html.indexOf("data-admin=\"cf-pin-approve\"") >= 0, 'Pin Approve uses data-admin');
assert(html.indexOf("data-admin=\"cf-pin-reject\"") >= 0, 'Pin Reject uses data-admin');
assert(html.indexOf("data-admin=\"pin\"") >= 0, 'Local pin approve data-admin');
assert(html.indexOf("data-admin=\"unpin-dismiss\"") >= 0, 'Local pin reject data-admin');
assert(html.indexOf("data-admin=\"delete\"") >= 0, 'Delete approve data-admin');
assert(html.indexOf("data-admin=\"remove-dismiss\"") >= 0, 'Delete reject data-admin');
assert(html.indexOf("data-admin=\"print-approve\"") >= 0, 'Print approve data-admin');
assert(html.indexOf("data-admin=\"print-reject\"") >= 0, 'Print reject data-admin');
assert(html.indexOf("data-admin=\"print-sent\"") >= 0, 'Print sent data-admin');
assert(html.indexOf("data-admin=\"coin-approve\"") >= 0, 'Coin approve data-admin');
assert(html.indexOf("data-admin=\"coin-reject\"") >= 0, 'Coin reject data-admin');
assert(html.indexOf("act==='cf-pin-approve'") >= 0, 'bindAdminClicks handles cf-pin-approve');
assert(html.indexOf("act==='print-reject'") >= 0, 'bindAdminClicks handles print-reject');
assert(html.indexOf("act==='coin-reject'") >= 0, 'bindAdminClicks handles coin-reject');
assert(html.indexOf("Admin password required to continue") >= 0, 're-prompt password after unlock/401');
assert(html.indexOf('setupAdminSections()') >= 0 && /toast\('Admin unlocked'\)[\s\S]{0,200}setupAdminSections/.test(html), 'setupAdminSections on unlock');
assert(html.indexOf('if(!prev.requestId && r.requestId) prev.requestId=r.requestId') >= 0, 'dedupe preserves requestId');
assert(html.indexOf("Pin failed") >= 0, 'adminPin reports real failure');
assert(html.indexOf('Approved via admin pin') >= 0 || html.indexOf('Clear matching CF pin') >= 0 || html.indexOf("Approved via admin pin") >= 0, 'approveFeature clears CF pending');
assert(!/toast\(act\+'\s*#'\+id\)/.test(html), 'no debug toast on every admin click');

console.log('\nAdmin approve/reject wiring checks passed');
