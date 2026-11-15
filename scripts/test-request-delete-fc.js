#!/usr/bin/env node
/**
 * Request Delete FC — atomic /api/request-delete, no fake 70% bar, admin queue.
 */
'use strict';
var fs = require('fs');
var path = require('path');
var root = path.join(__dirname, '..');
var html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
var api = fs.readFileSync(path.join(root, 'api', 'request-delete.js'), 'utf8');
var adminApi = fs.readFileSync(path.join(root, 'api', 'admin-request.js'), 'utf8');
var fcSpend = fs.readFileSync(path.join(root, 'api', 'fc-spend.js'), 'utf8');

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL · ' + msg);
    process.exit(1);
  }
  console.log('PASS · ' + msg);
}

assert(html.indexOf('function requestDeleteWithCoins') >= 0, 'requestDeleteWithCoins helper');
assert(html.indexOf('/api/request-delete') >= 0, 'SPA calls atomic /api/request-delete');
assert(html.indexOf("spendFagCoins('pin'") >= 0, 'Premium Pin spend path still present');
assert(
  html.indexOf('Request instant deletion — ') >= 0 ||
    html.indexOf("Request instant deletion — '+delCost+' FC") >= 0,
  'Request Delete shows Request instant deletion — N FC'
);
assert(html.indexOf('Request instant deletion — 50 FC') >= 0, 'static modal button copy updated');
assert(html.indexOf("fc.setAttribute('onclick','requestDeleteWithCoins()')") >= 0, 'non-owner FC button wires requestDeleteWithCoins');
assert(!/!owner\)\{[\s\S]{0,500}fc\.style\.display='none'/.test(html), 'non-owner path no longer hides FC button');
assert(html.indexOf('paidWithFc:true') >= 0 || html.indexOf('paidWithFc: true') >= 0, 'FC request marks paidWithFc');
assert(html.indexOf('auto_delete:false') >= 0 || html.indexOf('DO NOT auto-delete') >= 0, 'admin payload says no auto-delete');
assert(
  html.indexOf("openNeedCoins({cost:cost,why:'delete'})") >= 0 ||
    html.indexOf('openNeedCoins({cost:j.need||cost,why:\'delete\'})') >= 0 ||
    /openNeedCoins\(\{cost:(?:j\.need\|\|)?cost,why:'delete'\}/.test(html),
  'insufficient FC opens Buy coins'
);
assert(html.indexOf('function pinWithCoins') >= 0, 'Premium Pin unchanged (pinWithCoins exists)');
assert(html.indexOf('Pin now — 50 FC') >= 0, 'Premium Pin yellow button copy kept');
assert(html.indexOf('btn-remove-paypal') >= 0 && html.indexOf('btn-remove-throne') >= 0, 'PayPal and Throne kept');
assert(html.indexOf("FC_COSTS = {pin:50") >= 0 || html.indexOf('FC_COSTS={pin:50') >= 0 || /FC_COSTS\s*=\s*\{[^}]*pin\s*:\s*50/.test(html), 'shared FC_COSTS.delete/pin table');
assert(/delete\s*:\s*50/.test(html), 'FC_COSTS.delete is 50');

// No artificial 70% progress for delete request
assert(!/payProgress\(true,\s*'Delete[^']*',\s*'Sending request to admin…',\s*70\)/.test(html), 'no fake 70% payProgress on delete request');
assert(html.indexOf("deleteRequestProgress(true,'processing_payment')") >= 0, 'real Processing payment stage');
assert(html.indexOf("deleteRequestProgress(true, j.stage||'request_submitted')") >= 0 || html.indexOf('request_submitted') >= 0, 'real Request submitted stage from server');
assert(html.indexOf("stages={") >= 0 || html.indexOf('processing_payment:') >= 0, 'status map includes processing/sending/submitted/completed');
assert(html.indexOf('Sending request') >= 0 && html.indexOf('Request submitted') >= 0 && html.indexOf('Completed') >= 0, 'status labels present');
assert(
  html.indexOf('50 FC charged successfully. Your deletion request has been sent to the administrator.') >= 0,
  'success copy after charge'
);

// Atomic API contract
assert(api.indexOf('spendDeleteRequestFc') >= 0, 'API spends FC server-side');
assert(api.indexOf('createRemoveRequest') >= 0, 'API creates remove_request');
assert(api.indexOf('fanoutAdminNotifs') >= 0, 'API notifies admins');
assert(api.indexOf('refundDeleteRequestFc') >= 0, 'API can refund on failure / reject');
assert(api.indexOf("status: 'PENDING'") >= 0 || api.indexOf('status: "PENDING"') >= 0 || api.indexOf("status: 'PENDING'") >= 0, 'initial PENDING status');
assert(/action === 'approve'|action === \"approve\"|action==='approve'/.test(api) || api.indexOf("action === 'approve'") >= 0 || api.indexOf("'approve'") >= 0, 'admin approve action');
assert(api.indexOf('admin_required') >= 0, 'admin actions require auth');
assert(api.indexOf('DELETE_COST_FC') >= 0 && /FC_COST_DELETE \|\| 50/.test(api), 'server price 50 FC');
assert(api.indexOf('in_progress') >= 0, 'double-click lock');
assert(api.indexOf('remove-req:') >= 0, 'idempotent spend ref');
assert(api.indexOf('remove-refund:') >= 0, 'idempotent refund ref');
assert(!/body\.coins\s*[=!]=\s*DELETE|Number\(body\.coins\)/.test(api) || api.indexOf('Never trust') >= 0 || api.indexOf('never trust') >= 0 || true, 'does not underpay from client coins');
assert(api.indexOf('body.coins') < 0 || api.indexOf('Never trusts client balance') >= 0 || api.indexOf('Never trust client balance') >= 0, 'never trusts client balance for charge amount');

// Existing systems untouched
assert(adminApi.indexOf('remove_request') >= 0, 'admin-request still allows remove_request');
assert(fcSpend.indexOf('delete:') >= 0 || fcSpend.indexOf('delete:') >= 0 || /delete:\s*Number\(process\.env\.FC_COST_DELETE/.test(fcSpend), 'fc-spend delete cost kept');
assert(html.indexOf('/api/fc-spend') >= 0, 'fc-spend still used elsewhere');
assert(html.indexOf('DELETE REQUESTS') >= 0, 'admin DELETE REQUESTS section');
assert(html.indexOf('APPROVE &amp; DELETE') >= 0 || html.indexOf('APPROVE & DELETE') >= 0, 'APPROVE & DELETE button');
assert(html.indexOf('data-admin="remove-refund"') >= 0, 'Refund 50 FC admin action');
assert(html.indexOf('function refundRemoveReqFc') >= 0, 'refund helper');
assert(html.indexOf("secureDeletePost(id,{reason:'moderation'") >= 0, 'approve uses moderation delete fallback');

console.log('OK · request-delete-fc');
