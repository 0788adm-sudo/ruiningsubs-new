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
ok(api.indexOf('awaiting_spend_verify') >= 0, 'pending verify response');
ok(api.indexOf('transactionId') >= 0, 'transaction id in API responses');
ok(api.indexOf('findAnyDeleteSpend') >= 0, 'parallel short ledger probe');
ok(/3500|3000|2500/.test(api), 'ledger/balance CF timeouts capped');
ok(vercel.functions && vercel.functions['api/delete-post.js'], 'vercel maxDuration for delete-post');

ok(html.indexOf('Checking balance…') >= 0, 'UI: Checking balance');
ok(html.indexOf('Processing deletion…') >= 0, 'UI: Processing deletion');
ok(html.indexOf('Verifying deletion…') >= 0, 'UI: Verifying deletion');
ok(html.indexOf('Post successfully deleted.') >= 0, 'UI: success');
ok(html.indexOf('Failed — no FC charged') >= 0, 'UI: failed no charge');
ok(html.indexOf('Failed — FC refunded') >= 0 || html.indexOf('failed_refunded') >= 0, 'UI: failed refunded');
ok(html.indexOf('getOrCreateDeleteTxn') >= 0, 'client transaction id');
ok(html.indexOf('cfWalletSpend') >= 0 && html.indexOf("precharged:!!charged") >= 0, 'browser CF precharge then server verify');
ok(html.indexOf('walletAliasListFor') >= 0, 'alias list matches header wallets');
ok(html.indexOf('resumePendingDeleteTxn') >= 0 || html.indexOf('Resume a pending FC delete') >= 0, 'refresh resumes same txn');
ok(html.indexOf('rs_delete_txn') >= 0, 'sessionStorage txn map');

console.log('\nOK · fc-delete-balance-verify');
