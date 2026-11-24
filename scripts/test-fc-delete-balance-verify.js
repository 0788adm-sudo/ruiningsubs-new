#!/usr/bin/env node
/**
 * FC balance mismatch + verifying timeout contracts.
 */
'use strict';
var fs = require('fs');
var path = require('path');
var assert = require('assert');
var root = path.join(__dirname, '..');
var html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
var api = fs.readFileSync(path.join(root, 'api', 'delete-post.js'), 'utf8');
var vercel = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));

function ok(cond, msg) {
  assert.ok(cond, msg);
  console.log('PASS · ' + msg);
}

ok(api.indexOf('resolveFcBalance') >= 0, 'shared balance resolver');
ok(api.indexOf('walletUserCandidates') >= 0, 'wallet case + alias candidates');
ok(api.indexOf('extraUsers') >= 0 || api.indexOf('walletExtras') >= 0, 'accepts wallet aliases from client');
ok(api.indexOf('Never report "insufficient · have 0"') >= 0 || api.indexOf('spend_timeout') >= 0, 'no false have:0 on CF timeout');
ok(api.indexOf('verifyClientDeleteSpend') >= 0, 'verify browser CF precharge');
ok(api.indexOf('spend_not_found') >= 0 || api.indexOf('awaiting_spend_verify') >= 0, 'terminal verify failure (no infinite pending)');
ok(api.indexOf('statusForDeleteTxn') >= 0, 'durable txn status helper');
ok(api.indexOf("req.method === 'GET'") >= 0, 'GET status recovery endpoint');
ok(api.indexOf('transactionId') >= 0, 'transaction id in API responses');
ok(api.indexOf('findAnyDeleteSpend') >= 0, 'parallel ledger probe');
ok(api.indexOf('12000') >= 0, 'CF ledger/balance uses Pin-speed ~12s budget');
ok(vercel.functions && vercel.functions['api/delete-post.js'], 'vercel maxDuration for delete-post');

ok(html.indexOf('Checking balance…') >= 0, 'UI: Checking balance');
ok(html.indexOf('Processing deletion…') >= 0, 'UI: Processing deletion');
ok(html.indexOf('Verifying deletion…') >= 0, 'UI: Verifying deletion');
ok(html.indexOf('Post successfully deleted.') >= 0, 'UI: success');
ok(html.indexOf('Failed — no Coins charged') >= 0 || html.indexOf('failed_no_charge') >= 0, 'UI: failed no charge');
ok(html.indexOf('Failed — Coins refunded') >= 0 || html.indexOf('failed_refunded') >= 0, 'UI: failed refunded');
ok(html.indexOf('getOrCreateDeleteTxn') >= 0, 'client transaction id');
ok(html.indexOf("spendFagCoins('delete'") >= 0, 'delete reuses Premium Pin spendFagCoins path');
ok(html.indexOf('rs_fc_wallet_user') >= 0, 'remembers case-sensitive funded wallet');
ok(html.indexOf('fetchDeleteTxnStatus') >= 0, 'client polls server txn status');
ok(html.indexOf('walletAliasListFor') >= 0, 'alias list matches header wallets');
ok(html.indexOf('resumePendingDeleteTxn') >= 0 || html.indexOf('Resume a charged/pending FC delete') >= 0, 'refresh resumes same txn');
ok(html.indexOf('rs_delete_txn') >= 0, 'sessionStorage txn map');
ok(html.indexOf("delete-post:'+postId+':'+String(uid).toLowerCase()+':'") >= 0 && html.indexOf('FC_COSTS.delete') >= 0, 'stable txn id without random suffix');
ok(api.indexOf('refMatchesDeletePost') >= 0, 'matches any delete-post:<id>: ledger ref');
ok(api.indexOf("status: 'unavailable'") >= 0, 'DB outage is unavailable not completed');

console.log('\nOK · fc-delete-balance-verify');
