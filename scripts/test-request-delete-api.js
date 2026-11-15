#!/usr/bin/env node
/**
 * FC auto-delete lives in /api/delete-post.
 * /api/request-delete must NOT exist (Vercel break + product: no FC admin queue).
 */
'use strict';
var fs = require('fs');
var path = require('path');
var root = path.join(__dirname, '..');
var delApi = fs.readFileSync(path.join(root, 'api', 'delete-post.js'), 'utf8');
var html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

function assert(c, m) {
  if (!c) {
    console.error('FAIL · ' + m);
    process.exit(1);
  }
  console.log('PASS · ' + m);
}

assert(!fs.existsSync(path.join(root, 'api', 'request-delete.js')), 'api/request-delete.js removed');
assert(html.indexOf('/api/request-delete') < 0, 'SPA does not call /api/request-delete');
assert(delApi.indexOf('refundDeleteFc') >= 0, 'delete-post refunds on failure');
assert(delApi.indexOf('delete_refund') >= 0, 'delete refund ledger action');
assert(delApi.indexOf('already_deleted') >= 0, 'idempotent delete');
assert(delApi.indexOf('admin_notified: false') >= 0, 'no admin notify on FC delete');
assert(/paidForce|reason === 'paid'/.test(delApi), 'paid removal path');
assert(delApi.indexOf('DELETE_COST_FC') >= 0, 'server price constant');
assert(delApi.indexOf('insufficient') >= 0, 'insufficient FC');
assert(html.indexOf('function adminRequestDeleteAction') >= 0, 'admin actions use local helper');
assert(html.indexOf('adminAcceptCoins') >= 0, 'legacy FC refund uses adminAcceptCoins');

console.log('OK · request-delete-api / delete-post auto');
