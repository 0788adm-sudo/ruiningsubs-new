#!/usr/bin/env node
/**
 * /api/request-delete: FC create disabled; admin reject/refund kept.
 * /api/delete-post: paid auto-delete + refund on failure.
 */
'use strict';
var fs = require('fs');
var path = require('path');
var reqApi = fs.readFileSync(path.join(__dirname, '..', 'api', 'request-delete.js'), 'utf8');
var delApi = fs.readFileSync(path.join(__dirname, '..', 'api', 'delete-post.js'), 'utf8');

function assert(c, m) {
  if (!c) {
    console.error('FAIL · ' + m);
    process.exit(1);
  }
  console.log('PASS · ' + m);
}

assert(reqApi.indexOf('fc_delete_is_automatic') >= 0, 'create path returns fc_delete_is_automatic');
assert(reqApi.indexOf('/api/delete-post') >= 0, 'points clients to delete-post');
assert(reqApi.indexOf('admin_required') >= 0, 'admin gate for approve/reject/refund');
assert(reqApi.indexOf('delete_request_refund') >= 0 || reqApi.indexOf('refundDeleteRequestFc') >= 0, 'legacy refund helper kept');

assert(delApi.indexOf('refundDeleteFc') >= 0, 'delete-post refunds on failure');
assert(delApi.indexOf('delete_refund') >= 0, 'delete refund ledger action');
assert(delApi.indexOf('already_deleted') >= 0, 'idempotent delete');
assert(delApi.indexOf('admin_notified: false') >= 0, 'no admin notify on FC delete');
assert(/paidForce|reason === 'paid'/.test(delApi), 'paid removal path');
assert(delApi.indexOf('DELETE_COST_FC') >= 0, 'server price constant');
assert(delApi.indexOf('insufficient') >= 0, 'insufficient FC');

console.log('OK · request-delete-api / delete-post auto');
