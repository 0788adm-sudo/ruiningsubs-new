#!/usr/bin/env node
/**
 * FC Delete Now — atomic /api/delete-post auto-delete (no admin request).
 * PayPal / I paid stay on the admin request path.
 */
'use strict';
var fs = require('fs');
var path = require('path');
var root = path.join(__dirname, '..');
var html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
var delApi = fs.readFileSync(path.join(root, 'api', 'delete-post.js'), 'utf8');
var adminApi = fs.readFileSync(path.join(root, 'api', 'admin-request.js'), 'utf8');
var fcSpend = fs.readFileSync(path.join(root, 'api', 'fc-spend.js'), 'utf8');

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL · ' + msg);
    process.exit(1);
  }
  console.log('PASS · ' + msg);
}

assert(!fs.existsSync(path.join(root, 'api', 'request-delete.js')), 'api/request-delete.js removed');
assert(html.indexOf('/api/request-delete') < 0, 'no /api/request-delete references in SPA');

assert(html.indexOf('function requestDeleteWithCoins') >= 0, 'requestDeleteWithCoins helper');
assert(html.indexOf("reason:'paid'") >= 0 || html.indexOf('reason:\'paid\'') >= 0, 'FC path uses reason=paid');
assert(html.indexOf('/api/delete-post') >= 0, 'SPA uses /api/delete-post for FC delete');
assert(
  html.indexOf("secureDeletePost(id,{reason:'paid'") >= 0 ||
    /secureDeletePost\(id,\s*\{\s*reason:'paid'/.test(html),
  'requestDeleteWithCoins calls secureDeletePost paid'
);
(function () {
  var m = html.match(/async function requestDeleteWithCoins\(\)\{[\s\S]*?\n    \}/);
  assert(!!m, 'requestDeleteWithCoins body extractable');
  assert(m[0].indexOf('/api/request-delete') < 0, 'requestDeleteWithCoins does not call /api/request-delete');
  assert(m[0].indexOf('/api/delete-post') >= 0 || m[0].indexOf('secureDeletePost') >= 0, 'requestDeleteWithCoins uses secure delete');
  assert(m[0].indexOf('precharged') >= 0, 'requestDeleteWithCoins passes precharged');
  assert(m[0].indexOf('transactionId') >= 0 || m[0].indexOf('idempotencyKey') >= 0, 'requestDeleteWithCoins passes txn id');
})();
assert(html.indexOf("spendFagCoins('pin'") >= 0, 'Premium Pin spend path still present');
assert(
  html.indexOf("Delete now — '+delCost+' Coins") >= 0 || html.indexOf('Delete now — 10 Coins') >= 0,
  'Delete now — N FC button copy'
);
assert(html.indexOf('Delete now — 10 Coins') >= 0, 'static modal button copy');
assert(html.indexOf("fc.setAttribute('onclick','requestDeleteWithCoins()')") >= 0, 'non-owner FC button wires requestDeleteWithCoins');
assert(html.indexOf('function pinWithCoins') >= 0, 'Premium Pin unchanged');
assert(html.indexOf('Pin now — 10 Coins') >= 0, 'Premium Pin yellow button copy kept');
assert(html.indexOf('btn-remove-paypal') >= 0 && html.indexOf('btn-remove-throne') >= 0, 'PayPal and Throne kept');
assert(html.indexOf('I paid $5 — pending admin verify') >= 0, 'I paid kept for external payments');
assert(/delete\s*:\s*10/.test(html), 'FC_COSTS.delete is 10');
assert(html.indexOf("openNeedCoins({cost:j.need||j.cost||50,why:'delete post'})") >= 0 || html.indexOf("why:'delete post'") >= 0, 'insufficient FC opens buy coins');

// Auto-delete contract (no admin for FC)
assert(html.indexOf('deletes it immediately') >= 0 || html.indexOf('automatic') >= 0 || html.indexOf('Never creates an admin request') >= 0, 'UI says FC deletes immediately');
assert(html.indexOf('NO admin notification') >= 0 || html.indexOf('Never creates an admin request') >= 0, 'no admin notify for FC');
assert(delApi.indexOf('admin_notified: false') >= 0, 'API reports no admin notify');
assert(delApi.indexOf('auto_deleted: true') >= 0, 'API reports auto delete');
assert(delApi.indexOf('refundDeleteFc') >= 0, 'API refunds if delete fails after charge');
assert(delApi.indexOf("reason === 'paid'") >= 0 || delApi.indexOf("reason === 'paid'") >= 0, 'API accepts paid reason');
assert(delApi.indexOf('already_deleted') >= 0, 'idempotent already-deleted response');

// PayPal / I paid admin tooling kept; FC has no pending queue
assert(adminApi.indexOf('remove_request') >= 0, 'admin-request still allows remove_request for $5');
assert(html.indexOf('submitRemoveRequest') >= 0, 'I paid still uses submitRemoveRequest');
assert(html.indexOf("kind:'remove_request'") >= 0, 'external pay still notifies admin');
assert(html.indexOf('function adminRequestDeleteAction') >= 0, 'admin approve/reject helper present');
assert(fcSpend.indexOf('delete') >= 0, 'fc-spend delete cost kept for other spends');

// Progress is delete-oriented, not admin-request-oriented
assert(
  html.indexOf("deleteRequestProgress(true,'checking_balance'") >= 0 ||
    html.indexOf("deleteRequestProgress(true,'processing_deletion'") >= 0 ||
    html.indexOf("deleteRequestProgress(true,'processing_payment'") >= 0,
  'checking/processing progress stage'
);
assert(html.indexOf("deleteRequestProgress(true,'completed'") >= 0, 'completed stage');
assert(html.indexOf('Checking balance…') >= 0, 'checking balance copy');
assert(html.indexOf('Processing deletion…') >= 0, 'processing deletion copy');
assert(html.indexOf('Verifying deletion…') >= 0, 'verifying deletion copy');
assert(html.indexOf('Post successfully deleted.') >= 0 || html.indexOf('Post deleted successfully') >= 0, 'success copy');
assert(html.indexOf('Failed — no Coins charged') >= 0, 'failed no charge copy');
assert(html.indexOf('Failed — Coins refunded') >= 0 || html.indexOf('failed_refunded') >= 0, 'failed refunded copy');
assert(html.indexOf('getOrCreateDeleteTxn') >= 0, 'delete transaction id helper');
assert(html.indexOf('precharged') >= 0, 'client precharge flag for CF spend');
assert(html.indexOf('Sending request to admin') < 0, 'no sending-to-admin progress for FC');
assert(html.indexOf('Your deletion request has been sent to the administrator') < 0, 'no admin-request success toast on FC path');
assert(html.indexOf('admin will review (post stays up)') < 0, 'no admin-will-review FC toast');
assert(html.indexOf('DELETE FC REQUEST') < 0, 'no FC admin request message');
assert(html.indexOf('Post deleted successfully') >= 0, 'exact success toast');
assert(html.indexOf('submitRemoveRequest blocked Coins path') >= 0 || html.indexOf('submitRemoveRequest blocked FC path') >= 0, 'submitRemoveRequest redirects Coins to auto-delete');
assert(delApi.indexOf('sbRest') >= 0, 'delete-post REST fallback present');
assert(delApi.indexOf('walletUserCandidates') >= 0, 'delete-post preserves wallet casing');
assert(delApi.indexOf('resolveFcBalance') >= 0, 'delete-post resolves same balance as header');
assert(delApi.indexOf('spendSupabaseFc') >= 0, 'delete-post can spend Supabase coin_wallets');
assert(delApi.indexOf('verifyClientDeleteSpend') >= 0, 'delete-post verifies client CF precharge');
assert(delApi.indexOf('spend_not_found') >= 0 || delApi.indexOf('awaiting_spend_verify') >= 0, 'delete-post terminal verify failure');
assert(delApi.indexOf('statusForDeleteTxn') >= 0, 'delete-post status recovery');
assert(delApi.indexOf('spend_timeout') >= 0, 'delete-post does not mask CF timeout as empty wallet');
assert(html.indexOf("spendFagCoins('delete'") >= 0, 'delete uses same spendFagCoins as Pin');
assert(html.indexOf('Same numeric truth as /api/delete-post') >= 0 || html.indexOf('highest of CF') >= 0, 'header uses same balance resolution');
assert(
  JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).dependencies['@supabase/supabase-js'],
  'package.json ships @supabase/supabase-js for Vercel'
);

console.log('OK · request-delete-fc (auto-delete)');
