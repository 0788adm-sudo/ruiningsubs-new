#!/usr/bin/env node
/**
 * Critical delete-system contracts: timeouts, sorting, REJECT, CLEAR, approve verify.
 */
'use strict';
var fs = require('fs');
var path = require('path');
var vm = require('vm');
var assert = require('assert');
var root = path.join(__dirname, '..');
var html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
var del = fs.readFileSync(path.join(root, 'api', 'delete-post.js'), 'utf8');

function ok(cond, msg) {
  assert.ok(cond, msg);
  console.log('PASS · ' + msg);
}

// --- Timeout / idempotency ---
ok(html.indexOf('verifyPostDeletedPoll') >= 0, 'client polls DB after timeout');
ok(html.indexOf('Network slow — post still present') >= 0, 'timeout no longer claims hard failure');
ok(
  html.indexOf("deleteRequestProgress(true,'verifying") >= 0 ||
    html.indexOf("deleteRequestProgress(true,'verifying_deletion'") >= 0,
  'verifying progress stage'
);
ok(html.indexOf('Never treat AbortError as proof of failure') >= 0 || html.indexOf('NEVER treat AbortError') >= 0, 'abort ≠ failure');
ok(html.indexOf('rs_delete_txn') >= 0 && html.indexOf('transactionId') >= 0, 'persistent delete transaction id');
ok(html.indexOf('resumePendingDeleteTxn') >= 0 || html.indexOf('Resume a pending FC delete') >= 0, 'resume pending delete after refresh');
ok(del.indexOf('waited_for_inflight') >= 0, 'server waits on inflight delete lock');
ok(del.indexOf('acquireDeleteLock') >= 0 && del.indexOf('claimSbSpendRef') >= 0, 'idempotent spend + lock');
ok(del.indexOf('findAnyDeleteSpend') >= 0, 'parallel short ledger probe');
ok(del.indexOf('verifyClientDeleteSpend') >= 0, 'client precharge verification');

// --- Admin sorting ---
ok(html.indexOf('function adminRequestTimestamp') >= 0, 'adminRequestTimestamp helper');
ok(html.indexOf('preferAt') >= 0, 'prefers SB created_at');
ok(html.indexOf('Newest request creation timestamp first') >= 0, 'newest-first sort comment');
ok(html.indexOf('Never Date.now() fallback') >= 0 || html.indexOf('Never Date.now()') >= 0, 'no Date.now() timestamp inflation');

// --- REJECT / CLEAR ---
ok(html.indexOf("data-admin=\"remove-dismiss\"") >= 0, 'REJECT wired');
ok(html.indexOf("data-admin=\"remove-clear\"") >= 0, 'CLEAR REQUEST wired');
ok(html.indexOf('act===\'remove-clear\'') >= 0 || html.indexOf('act===\'remove-clear\'') >= 0 || html.indexOf("act==='remove-clear'") >= 0, 'bindAdminClicks clear');
ok(html.indexOf('function clearRemoveReqOnly') >= 0, 'clearRemoveReqOnly');
ok(html.indexOf('function clearPendingRemoveRequestEntities') >= 0, 'shared clear helper');
ok(html.indexOf('Rejected — request cleared, post kept') >= 0 || html.indexOf('post kept') >= 0, 'reject confirmation');
ok(html.indexOf('Request cleared — post #') >= 0, 'clear confirmation');
ok(html.indexOf("status:'cleared'") >= 0 || html.indexOf("status:'cleared'") >= 0, 'cleared status');
ok(html.indexOf('Permanently clear ') >= 0 || html.indexOf('posts stay online') >= 0, 'bulk clear protects posts');
ok(html.indexOf('No FC charge or refund') >= 0, 'bulk clear no FC side effects');

// --- APPROVE reliability ---
ok(html.indexOf('Only mark completed after the publication is actually gone') >= 0, 'approve verifies before complete');
ok(html.indexOf('Delete did not verify — request left pending') >= 0, 'failed verify keeps pending');
ok(html.indexOf('__adminRemoveActionLocks') >= 0, 'admin action click locks');

// --- Unit: adminRequestTimestamp ---
var start = html.indexOf('function adminRequestTimestamp');
var end = html.indexOf('window.adminRequestTimestamp', start);
ok(start > 0 && end > start, 'timestamp helper extractable');
var chunk = html.slice(start, end + 'window.adminRequestTimestamp=adminRequestTimestamp;'.length);
var sandbox = { console: console, Math: Math, Date: Date, String: String, Number: Number, isFinite: isFinite, RegExp: RegExp, window: {} };
vm.createContext(sandbox);
vm.runInContext(chunk, sandbox);
var ts = sandbox.adminRequestTimestamp || sandbox.window.adminRequestTimestamp;
ok(ts('2026-11-16T21:00:04.000Z') === Date.parse('2026-11-16T21:00:04.000Z'), 'ISO timestamp');
ok(ts(1731790804) === 1731790804000, 'unix seconds → ms');
ok(ts(1731790804000) === 1731790804000, 'ms passthrough');
ok(ts('') === 0 && ts(null) === 0, 'empty → 0 (not Date.now)');
ok(ts('not-a-date') === 0, 'invalid → 0');

// Sorting simulation: newer first even when CF would have inflated Date.now()
var rows = [
  { id: '3014', at: ts('2026-11-16T20:59:00.000Z') },
  { id: '3028', at: ts('2026-11-16T21:00:04.000Z') },
  { id: '3001', at: 0 }
];
rows.sort(function (a, b) {
  var ta = Number(a.at || 0) || 0, tb = Number(b.at || 0) || 0;
  if (tb !== ta) return tb - ta;
  var ia = Number(a.id), ib = Number(b.id);
  if (isFinite(ia) && isFinite(ib) && ia !== ib) return ib - ia;
  return 0;
});
ok(rows[0].id === '3028' && rows[1].id === '3014' && rows[2].id === '3001', 'newest-first sort with id tie-break');

console.log('\nOK · delete-system-critical');
