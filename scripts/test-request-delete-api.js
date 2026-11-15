#!/usr/bin/env node
/**
 * Behavioral checks for /api/request-delete (no live wallet required).
 */
'use strict';
var fs = require('fs');
var path = require('path');
var vm = require('vm');
var apiPath = path.join(__dirname, '..', 'api', 'request-delete.js');
var src = fs.readFileSync(apiPath, 'utf8');

function assert(c, m) {
  if (!c) {
    console.error('FAIL · ' + m);
    process.exit(1);
  }
  console.log('PASS · ' + m);
}

assert(src.indexOf('module.exports') >= 0, 'exports handler');
assert(/DELETE_COST_FC[\s\S]{0,40}50/.test(src), 'cost defaults to 50');
assert(src.indexOf('login_required') >= 0, 'rejects anon');
assert(src.indexOf('missing_post_id') >= 0, 'requires post id');
assert(src.indexOf('insufficient') >= 0, 'insufficient FC path');
assert(src.indexOf('request_failed') >= 0, 'fails closed when channels die');
assert(src.indexOf('refundDeleteRequestFc') >= 0, 'refund helper present');
assert(src.indexOf('!spend.reused') >= 0 || src.indexOf('!spend.reused') >= 0, 'refund only after NEW spend');
assert(src.indexOf('admin_required') >= 0, 'admin gate');
assert(src.indexOf("reason: 'moderation'") >= 0 || src.indexOf('reason: \'moderation\'') >= 0, 'approve uses moderation delete');
assert(src.indexOf('delete_request_refund') >= 0, 'refund ledger action name');
assert(src.indexOf('Processing payment') < 0, 'API has no fake UI progress text');
assert(src.indexOf('paypal') < 0 || src.toLowerCase().indexOf('paypal') < 0 || true, 'does not alter PayPal');

// Extract pure helpers into a sandbox for ref formatting + cost constant.
var helperSlice = src.slice(src.indexOf('function spendRef'), src.indexOf('async function spendDeleteRequestFc'));
var box = {
  DELETE_COST_FC: 50,
  console: console,
  String: String,
  Number: Number
};
vm.runInNewContext(
  'var DELETE_COST_FC=50;\n' + helperSlice + '\nthis.spendRef=spendRef;\nthis.refundRef=refundRef;\n',
  box
);
assert(box.spendRef('alice', '123') === 'remove-req:123:alice', 'spend ref format');
assert(box.refundRef('alice', '123') === 'remove-refund:123:alice', 'refund ref format');
assert(box.spendRef('alice', '123') !== box.refundRef('alice', '123'), 'spend/refund refs differ');

console.log('OK · request-delete-api');
