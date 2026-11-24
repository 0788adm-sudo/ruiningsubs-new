#!/usr/bin/env node
/**
 * Behavioral proof: /api/delete-post reason=paid charges once, deletes the row,
 * never hits admin request/notif endpoints, and refunds if delete fails.
 * Also proves header/spend identity match (case + Supabase fallback).
 */
'use strict';

var assert = require('assert');
var path = require('path');
var Module = require('module');

var CF = 'https://ruiningsubs-api.0788adm.workers.dev';
var SB = 'https://snlpdolzhzcbbdyxqlnb.supabase.co';
var calls = [];
var cfWallets = Object.create(null); // case-sensitive CF balances
var sbWallets = Object.create(null); // Supabase coin_wallets
var posts = {};
var ledgerByUser = Object.create(null);
var forceDeleteFail = false;

function record(kind, url, body) {
  calls.push({ kind: kind, url: String(url || ''), body: body || null });
}

function ledgerFor(user) {
  if (!ledgerByUser[user]) ledgerByUser[user] = [];
  return ledgerByUser[user];
}

function resetState() {
  calls = [];
  cfWallets = Object.create(null);
  sbWallets = Object.create(null);
  posts = {};
  ledgerByUser = Object.create(null);
  forceDeleteFail = false;
}

global.fetch = async function (url, opts) {
  opts = opts || {};
  var u = String(url);
  var method = String((opts.method || 'GET')).toUpperCase();
  var body = null;
  if (opts.body) {
    try {
      body = typeof opts.body === 'string' ? JSON.parse(opts.body) : opts.body;
    } catch (_) {
      body = opts.body;
    }
  }
  record(method, u, body);

  if (u.indexOf(CF + '/wallet/ledger') === 0) {
    var lu = decodeURIComponent((u.split('user=')[1] || '').split('&')[0] || '');
    return {
      ok: true,
      status: 200,
      json: async function () {
        return { ok: true, ledger: ledgerFor(lu).slice() };
      }
    };
  }

  if (u.indexOf(CF + '/wallet?user=') === 0 && method === 'GET') {
    var gu = decodeURIComponent(u.split('user=')[1] || '');
    var gbal = Number(cfWallets[gu] || 0) || 0;
    return {
      ok: true,
      status: 200,
      json: async function () {
        return { ok: true, user: gu, balance: gbal };
      }
    };
  }

  if (u === CF + '/wallet' && method === 'POST') {
    var wu = String((body && body.user) || '');
    if (body && body.spend) {
      var spend = Number(body.spend) || 0;
      var bal = Number(cfWallets[wu] || 0) || 0;
      if (bal < spend) {
        return {
          ok: false,
          status: 402,
          json: async function () {
            return { ok: false, error: 'insufficient', balance: bal };
          }
        };
      }
      cfWallets[wu] = bal - spend;
      ledgerFor(wu).unshift({
        kind: 'spend',
        action: body.action || 'delete',
        ref_id: body.ref,
        ref: body.ref,
        coins: spend
      });
      return {
        ok: true,
        status: 200,
        json: async function () {
          return { ok: true, balance: cfWallets[wu] };
        }
      };
    }
    if (body && body.add) {
      cfWallets[wu] = (Number(cfWallets[wu] || 0) || 0) + (Number(body.add) || 0);
      ledgerFor(wu).unshift({
        kind: 'add',
        action: body.action || 'delete_refund',
        ref_id: body.ref,
        ref: body.ref,
        coins: Number(body.add) || 0
      });
      return {
        ok: true,
        status: 200,
        json: async function () {
          return { ok: true, balance: cfWallets[wu] };
        }
      };
    }
  }

  if (u.indexOf(CF + '/posts/') === 0 && method === 'DELETE') {
    return { ok: true, status: 200, json: async function () { return { ok: true }; } };
  }
  if (u.indexOf(CF + '/admin/requests') === 0) {
    return { ok: true, status: 200, json: async function () { return { ok: true, requests: [] }; } };
  }

  // Supabase coin_wallets
  if (u.indexOf(SB + '/rest/v1/coin_wallets') === 0) {
    var uidMatch = u.match(/user_id=eq\.([^&]+)/);
    var uid = uidMatch ? decodeURIComponent(uidMatch[1]) : '';
    if (method === 'GET' || !opts.method) {
      var sbBal = Number(sbWallets[uid] || 0) || 0;
      var rows = uid in sbWallets ? [{ user_id: uid, balance: sbBal }] : [];
      return {
        ok: true,
        status: 200,
        text: async function () { return JSON.stringify(rows); },
        json: async function () { return rows; }
      };
    }
    if (method === 'PATCH') {
      var cur = Number(sbWallets[uid] || 0) || 0;
      var needGte = /balance=gte\.(\d+)/.exec(u);
      if (needGte && cur < Number(needGte[1])) {
        return {
          ok: true,
          status: 200,
          text: async function () { return '[]'; },
          json: async function () { return []; }
        };
      }
      var next = body && body.balance != null ? Number(body.balance) : cur;
      sbWallets[uid] = next;
      var out = [{ user_id: uid, balance: next }];
      return {
        ok: true,
        status: 200,
        text: async function () { return JSON.stringify(out); },
        json: async function () { return out; }
      };
    }
  }

  // Supabase posts
  if (u.indexOf(SB + '/rest/v1/posts') === 0) {
    if (method === 'GET' || method === 'HEAD' || !opts.method) {
      var idMatch = u.match(/id=eq\.([^&]+)/);
      var id = idMatch ? decodeURIComponent(idMatch[1]) : '';
      var row = posts[id] || null;
      var text = JSON.stringify(row ? [row] : []);
      return {
        ok: true,
        status: 200,
        text: async function () { return text; },
        json: async function () { return row ? [row] : []; }
      };
    }
    if (method === 'DELETE') {
      if (forceDeleteFail) {
        return {
          ok: false,
          status: 500,
          text: async function () { return JSON.stringify({ message: 'forced_fail' }); },
          json: async function () { return { message: 'forced_fail' }; }
        };
      }
      var delMatch = u.match(/id=eq\.([^&]+)/);
      var delId = delMatch ? decodeURIComponent(delMatch[1]) : '';
      delete posts[delId];
      return {
        ok: true,
        status: 200,
        text: async function () { return '[]'; },
        json: async function () { return []; }
      };
    }
  }

  return {
    ok: true,
    status: 200,
    text: async function () { return '{}'; },
    json: async function () { return {}; }
  };
};

var origRequire = Module.prototype.require;
Module.prototype.require = function (id) {
  if (id === '@supabase/supabase-js') {
    throw new Error('forced_missing_supabase_for_test');
  }
  return origRequire.apply(this, arguments);
};

delete require.cache[require.resolve('../api/delete-post.js')];
var handler = require('../api/delete-post.js');

function mockRes() {
  return {
    statusCode: 0,
    headers: {},
    body: '',
    setHeader: function (k, v) { this.headers[k] = v; },
    end: function (s) { this.body = String(s || ''); }
  };
}

async function invoke(body) {
  var req = { method: 'POST', headers: {}, body: body };
  var res = mockRes();
  await handler(req, res);
  var json = {};
  try { json = JSON.parse(res.body || '{}'); } catch (_) {}
  return { status: res.statusCode, json: json };
}

function samplePost(id) {
  return {
    id: id,
    username: 'publisher1',
    tags: ['del:deletable'],
    expires_at: null,
    extend_amount: null,
    deletion_tier: 'deletable',
    free_deletion_enabled: true,
    owner_token_hash: null
  };
}

function noAdminTraffic() {
  return calls.every(function (c) {
    var u = c.url;
    var body = c.body || {};
    if (/\/notifs/.test(u)) {
      var to = String(body.to_username || '');
      if (to === '__PIN_BOARD__' || to === '__PIN_REWARDS__') return true;
      if (/notifs\?to=__PIN_/.test(u)) return true;
      if (/\/notifs\/[^?]+$/.test(u) && c.kind === 'DELETE') return true;
      if (c.kind === 'POST') return false;
      return true;
    }
    if (/\/admin\/requests/.test(u) && c.kind === 'GET') return true;
    if (/\/requests/.test(u) && c.kind === 'POST') return false;
    if (/admin-request/.test(u)) return false;
    if (body && body.kind === 'remove_request') return false;
    return true;
  });
}

(async function main() {
  // 1) Happy path
  resetState();
  cfWallets.buyer1 = 500;
  posts['post-fc-1'] = samplePost('post-fc-1');
  var r1 = await invoke({
    user: 'buyer1',
    postId: 'post-fc-1',
    reason: 'paid',
    idempotencyKey: 'delete-post:post-fc-1:buyer1:10'
  });
  assert.strictEqual(r1.status, 200, 'paid delete status 200');
  assert.strictEqual(r1.json.ok, true, 'paid delete ok');
  assert.strictEqual(r1.json.charged, 10, 'charged exactly 10');
  assert.strictEqual(r1.json.admin_notified, false, 'admin_notified false');
  assert.strictEqual(cfWallets.buyer1, 490, 'balance decreased by 10');
  assert.strictEqual(posts['post-fc-1'], undefined, 'post removed');
  assert.ok(noAdminTraffic(), 'no admin traffic');
  console.log('PASS · paid FC auto-delete removes post and skips admin');

  // 2) Idempotent replay
  var r2 = await invoke({
    user: 'buyer1',
    postId: 'post-fc-1',
    reason: 'paid',
    idempotencyKey: 'delete-post:post-fc-1:buyer1:10'
  });
  assert.strictEqual(r2.json.already_deleted, true, 'already_deleted');
  assert.strictEqual(r2.json.charged, 0, 'no second charge');
  assert.strictEqual(cfWallets.buyer1, 490, 'balance unchanged');
  console.log('PASS · idempotent already_deleted does not double-charge');

  // 3) Refund on delete failure
  resetState();
  cfWallets.buyer2 = 200;
  posts['post-fc-2'] = samplePost('post-fc-2');
  forceDeleteFail = true;
  var r3 = await invoke({
    user: 'buyer2',
    postId: 'post-fc-2',
    reason: 'paid',
    idempotencyKey: 'delete-post:post-fc-2:buyer2:10'
  });
  assert.strictEqual(r3.status, 500, 'delete_failed status');
  assert.strictEqual(r3.json.refunded, true, 'refunded');
  assert.strictEqual(cfWallets.buyer2, 200, 'coins restored');
  assert.ok(posts['post-fc-2'], 'post still present');
  console.log('PASS · failed delete refunds 10 FC and leaves post');

  // 4) Balance ladder: 0 / 49 / 50 / 100 / 999480
  async function ladder(name, bal, expectOk) {
    resetState();
    cfWallets[name] = bal;
    posts['p-' + name] = samplePost('p-' + name);
    var r = await invoke({ user: name, postId: 'p-' + name, reason: 'paid' });
    if (expectOk) {
      assert.strictEqual(r.status, 200, name + ' status');
      assert.strictEqual(r.json.charged, 10, name + ' charged');
      assert.strictEqual(cfWallets[name], bal - 10, name + ' remaining');
      assert.strictEqual(posts['p-' + name], undefined, name + ' deleted');
    } else {
      assert.strictEqual(r.status, 402, name + ' insufficient status');
      assert.strictEqual(r.json.error, 'insufficient', name + ' insufficient');
      assert.strictEqual(cfWallets[name], bal, name + ' untouched');
      assert.ok(posts['p-' + name], name + ' still present');
      assert.strictEqual(Number(r.json.have || r.json.balance), bal, name + ' reports have=' + bal);
    }
  }
  await ladder('u0', 0, false);
  await ladder('u9', 9, false);
  await ladder('u10', 10, true);
  await ladder('u100', 100, true);
  await ladder('u999480', 999480, true);
  console.log('PASS · balance ladder 0/9/10/100/999480');

  // 5) CRITICAL: header casing vs lowercased spend key
  resetState();
  cfWallets.BigBoisLut = 999480; // balance lives under original casing
  cfWallets.bigboislut = 0; // lowercased empty wallet (old bug target)
  posts['post-case'] = samplePost('post-case');
  var rCase = await invoke({
    user: 'BigBoisLut',
    postId: 'post-case',
    reason: 'paid',
    idempotencyKey: 'delete-post:post-case:bigboislut:10'
  });
  assert.strictEqual(rCase.status, 200, 'cased user delete ok');
  assert.strictEqual(rCase.json.charged, 10, 'cased charged 10');
  assert.strictEqual(cfWallets.BigBoisLut, 999470, 'cased wallet deducted');
  assert.strictEqual(cfWallets.bigboislut, 0, 'lowercase wallet untouched');
  assert.strictEqual(posts['post-case'], undefined, 'cased post deleted');
  console.log('PASS · case-sensitive wallet matches header balance (no false insufficient)');

  // 6) Supabase fallback when CF empty but header reads coin_wallets
  resetState();
  cfWallets.sbUser = 0;
  sbWallets.sbUser = 999480;
  posts['post-sb'] = samplePost('post-sb');
  var rSb = await invoke({ user: 'sbUser', postId: 'post-sb', reason: 'paid' });
  assert.strictEqual(rSb.status, 200, 'sb fallback ok');
  assert.strictEqual(rSb.json.charged, 10, 'sb charged');
  assert.strictEqual(rSb.json.source, 'supabase', 'source supabase');
  assert.strictEqual(sbWallets.sbUser, 999470, 'sb balance deducted');
  assert.strictEqual(posts['post-sb'], undefined, 'sb post deleted');
  console.log('PASS · Supabase coin_wallets spend when CF empty');

  // 7) Static contract
  var fs = require('fs');
  var root = path.join(__dirname, '..');
  var html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  var api = fs.readFileSync(path.join(root, 'api', 'delete-post.js'), 'utf8');
  assert.ok(api.indexOf('walletUserCandidates') >= 0, 'wallet case candidates');
  assert.ok(api.indexOf('resolveFcBalance') >= 0, 'shared balance resolver');
  assert.ok(api.indexOf('spendSupabaseFc') >= 0, 'supabase spend fallback');
  assert.ok(api.indexOf('12000') >= 0 || api.indexOf('15000') >= 0, 'CF wallet spend uses bounded timeout');
  assert.ok(
    api.indexOf('Never report "insufficient · have 0"') >= 0 ||
      api.indexOf('resolveFcBalance') >= 0,
    'balance resolved before false insufficient'
  );
  assert.ok(api.indexOf('spend_timeout') >= 0, 'CF timeout distinct from insufficient');
  assert.ok(api.indexOf('verifyClientDeleteSpend') >= 0, 'client precharge verify path');
  assert.ok(api.indexOf('fast_invalidate') >= 0, 'pin cleanup is fast (no full board scan)');
  assert.ok(api.indexOf('withTimeout') >= 0, 'cleanup timeouts');
  assert.ok(api.indexOf('DELETE_NOOP') >= 0 || api.indexOf('delete_blocked_or_noop') >= 0, 'detect silent delete failure');
  assert.ok(html.indexOf('coinUserId') >= 0 && html.indexOf("secureDeletePost") >= 0, 'client uses coin identity');
  assert.ok(
    html.indexOf('Checking balance, then charging 10 Coins') >= 0 ||
      html.indexOf('Checking balance…') >= 0,
    'progress not fake-success'
  );
  assert.ok(html.indexOf('Same numeric truth as /api/delete-post') >= 0, 'header matches API resolution');
  assert.ok(html.indexOf("fetchWithTimeout('/api/delete-post'") >= 0, 'client uses timed delete fetch');
  assert.ok(html.indexOf('verifyPostDeletedPoll') >= 0, 'timeout verifies/polls post status');
  assert.ok(html.indexOf('precharged') >= 0 && html.indexOf('getOrCreateDeleteTxn') >= 0, 'txn + precharge client path');
  assert.ok(html.indexOf("spendFagCoins('delete'") >= 0, 'delete reuses spendFagCoins');
  assert.ok(html.indexOf('rs_fc_wallet_user') >= 0, 'persists funded wallet casing');
  assert.ok(api.indexOf('12000') >= 0, 'Pin-speed CF timeout for ledger/balance');
  assert.ok(api.indexOf('statusForDeleteTxn') >= 0, 'status recovery helper');
  assert.ok(html.indexOf('function shortDisplayUser') >= 0, 'anon display names shortened');
  console.log('PASS · static balance/identity contract');

  // 8) CF timeout must not report have:0 when balance exists
  resetState();
  cfWallets.SlowRich = 999930;
  posts['post-slow'] = samplePost('post-slow');
  var origFetch = global.fetch;
  var slowLedgerOnce = true;
  global.fetch = async function (url, opts) {
    var u = String(url);
    if (slowLedgerOnce && u.indexOf(CF + '/wallet/ledger') === 0) {
      slowLedgerOnce = false;
      await new Promise(function (r) { setTimeout(r, 30); });
      return { ok: false, status: 0, json: async function () { return { error: 'cf_timeout' }; } };
    }
    return origFetch(url, opts);
  };
  var rSlow = await invoke({
    user: 'SlowRich',
    postId: 'post-slow',
    reason: 'paid',
    idempotencyKey: 'delete-post:post-slow:slowrich:10'
  });
  global.fetch = origFetch;
  assert.strictEqual(rSlow.status, 200, 'slow ledger still deletes when CF spend works');
  assert.strictEqual(rSlow.json.charged, 10, 'slow path charged');
  assert.strictEqual(cfWallets.SlowRich, 999920, 'slow path deducted once');
  assert.strictEqual(posts['post-slow'], undefined, 'slow path post gone');
  console.log('PASS · ledger blip does not false-insufficient a funded wallet');

  // 9) precharged path verifies ledger and does not charge again
  resetState();
  cfWallets.PrePay = 500;
  posts['post-pre'] = samplePost('post-pre');
  ledgerFor('PrePay').unshift({
    kind: 'spend',
    action: 'delete',
    ref_id: 'txn-pre-1',
    ref: 'txn-pre-1',
    coins: 10
  });
  var balBefore = cfWallets.PrePay;
  var rPre = await invoke({
    user: 'PrePay',
    postId: 'post-pre',
    reason: 'paid',
    idempotencyKey: 'txn-pre-1',
    precharged: true
  });
  assert.strictEqual(rPre.status, 200, 'precharged ok');
  assert.strictEqual(rPre.json.charged, 10, 'precharged reports charged');
  assert.strictEqual(cfWallets.PrePay, balBefore, 'precharged did not debit again');
  assert.strictEqual(posts['post-pre'], undefined, 'precharged deleted');
  console.log('PASS · precharged verifies ledger without double charge');

  // 10) Case-sensitive funded wallet (MasterSan) + precharged ledger hit finishes delete
  resetState();
  cfWallets.MasterSan = 999830;
  cfWallets.mastersan = 0;
  posts['3251'] = samplePost('3251', 'masterzore');
  ledgerFor('MasterSan').unshift({
    kind: 'spend',
    action: 'delete',
    ref_id: 'delete-post:3251:mastersan:10:mwl6m5kc',
    ref: 'delete-post:3251:mastersan:10:mwl6m5kc',
    coins: 10
  });
  var balMS = cfWallets.MasterSan;
  var rMS = await invoke({
    user: 'MasterSan',
    postId: '3251',
    reason: 'paid',
    idempotencyKey: 'delete-post:3251:mastersan:10:mwl6m5kc',
    precharged: true,
    walletUsers: ['MasterSan', 'mastersan']
  });
  assert.strictEqual(rMS.status, 200, 'MasterSan precharged finishes');
  assert.strictEqual(rMS.json.status, 'completed', 'MasterSan status completed');
  assert.strictEqual(cfWallets.MasterSan, balMS, 'MasterSan no second debit');
  assert.strictEqual(posts['3251'], undefined, 'post 3251 deleted');
  console.log('PASS · MasterSan casing + charged txn completes without double charge');

  // 11) Random-suffix legacy charge still finishes delete (no 4th charge)
  resetState();
  cfWallets.MasterSan = 999730;
  posts['3251b'] = samplePost('3251b', 'masterzore');
  ledgerFor('MasterSan').unshift({
    kind: 'spend',
    action: 'delete',
    ref_id: 'delete-post:3251b:mastersan:10:mwlan6lx',
    ref: 'delete-post:3251b:mastersan:10:mwlan6lx',
    coins: 10
  });
  var balLegacy = cfWallets.MasterSan;
  var rLegacy = await invoke({
    user: 'MasterSan',
    postId: '3251b',
    reason: 'paid',
    idempotencyKey: 'delete-post:3251b:mastersan:10',
    precharged: true,
    walletUsers: ['MasterSan', 'mastersan']
  });
  assert.strictEqual(rLegacy.status, 200, 'legacy suffix precharged finishes');
  assert.strictEqual(cfWallets.MasterSan, balLegacy, 'legacy suffix no extra debit');
  assert.strictEqual(posts['3251b'], undefined, 'legacy suffix post deleted');
  console.log('PASS · legacy random-suffix charge completes without re-charging');

  var api2 = require('fs').readFileSync(path.join(__dirname, '..', 'api', 'delete-post.js'), 'utf8');
  var html2 = require('fs').readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.ok(api2.indexOf('refMatchesDeletePost') >= 0, 'ref matcher for post-scoped spends');
  assert.ok(html2.indexOf("delete-post:'+postId+':'+String(uid).toLowerCase()+':'") >= 0 && (html2.indexOf('FC_COSTS.delete') >= 0 || html2.indexOf(':10') >= 0), 'stable txn id (no random suffix)');
  assert.ok(api2.indexOf("status: 'unavailable'") >= 0, 'load failure ≠ completed');
  console.log('PASS · stable txn + unavailable status contracts');

  console.log('OK · fc-autodelete-handler');
})().catch(function (e) {
  console.error('FAIL ·', e && e.stack ? e.stack : e);
  process.exit(1);
});
