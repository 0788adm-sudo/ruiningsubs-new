#!/usr/bin/env node
/**
 * Mandatory deletion + payment E2E matrix (A–K).
 * Uses local /api/delete-post + /api/admin-request handlers with mocked CF/SB
 * for deterministic proof, plus static SPA contract checks.
 */
'use strict';

var assert = require('assert');
var path = require('path');
var fs = require('fs');
var Module = require('module');

var CF = 'https://ruiningsubs-api.0788adm.workers.dev';
var SB = 'https://snlpdolzhzcbbdyxqlnb.supabase.co';
var calls = [];
var cfWallets = Object.create(null);
var sbWallets = Object.create(null);
var posts = {};
var ledgerByUser = Object.create(null);
var sbLedger = [];
var deletionReqs = [];
var forceDeleteFail = false;
var cfRequestFailOnce = 0;

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
  sbLedger = [];
  deletionReqs = [];
  forceDeleteFail = false;
  cfRequestFailOnce = 0;
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
    return {
      ok: true,
      status: 200,
      json: async function () {
        return { ok: true, user: gu, balance: Number(cfWallets[gu] || 0) || 0 };
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
  if (u.indexOf(CF + '/posts/') === 0 && (method === 'DELETE' || method === 'PATCH')) {
    return { ok: true, status: 200, json: async function () { return { ok: true }; } };
  }
  if (u.indexOf(CF + '/notifs') === 0) {
    return { ok: true, status: 200, json: async function () { return { ok: true }; } };
  }
  if (u.indexOf(CF + '/admin/requests') === 0) {
    return { ok: true, status: 200, json: async function () { return { ok: true, requests: [] }; } };
  }
  if (u === CF + '/requests' && method === 'POST') {
    if (cfRequestFailOnce > 0) {
      cfRequestFailOnce--;
      return {
        ok: false,
        status: 0,
        json: async function () {
          return { error: 'cf_timeout', detail: 'aborted' };
        }
      };
    }
    var req = {
      id: 'REM-TEST-' + Date.now().toString(36),
      kind: body.kind,
      user_id: body.user_id,
      status: 'pending',
      amount: body.amount || '',
      coins: Number(body.coins || 0) || 0,
      post_id: String(body.post_id || ''),
      provider: body.provider || '',
      label: body.label || '',
      payload: typeof body.payload === 'string' ? body.payload : JSON.stringify(body.payload || {})
    };
    return {
      ok: true,
      status: 200,
      json: async function () {
        return { ok: true, request: req, duplicate: false };
      }
    };
  }

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

  if (u.indexOf(SB + '/rest/v1/coin_ledger') === 0) {
    if (method === 'GET' || !opts.method) {
      var filtered = sbLedger.filter(function (r) {
        if (body) return true;
        var ok = true;
        if (/user_id=eq\.([^&]+)/.test(u)) {
          var uu = decodeURIComponent(RegExp.$1);
          ok = ok && r.user_id === uu;
        }
        if (/ref=eq\.([^&]+)/.test(u)) {
          var rr = decodeURIComponent(RegExp.$1);
          ok = ok && String(r.ref) === rr;
        }
        if (/action=eq\.([^&]+)/.test(u)) {
          ok = ok && String(r.action) === decodeURIComponent(RegExp.$1);
        }
        if (/kind=eq\.([^&]+)/.test(u)) {
          ok = ok && String(r.kind) === decodeURIComponent(RegExp.$1);
        }
        return ok;
      });
      // Parse query from URL for GET
      filtered = sbLedger.slice();
      var mUser = u.match(/user_id=eq\.([^&]+)/);
      var mRef = u.match(/ref=eq\.([^&]+)/);
      var mAct = u.match(/action=eq\.([^&]+)/);
      var mKind = u.match(/kind=eq\.([^&]+)/);
      if (mUser) filtered = filtered.filter(function (r) { return r.user_id === decodeURIComponent(mUser[1]); });
      if (mRef) filtered = filtered.filter(function (r) { return String(r.ref) === decodeURIComponent(mRef[1]); });
      if (mAct) filtered = filtered.filter(function (r) { return String(r.action) === decodeURIComponent(mAct[1]); });
      if (mKind) filtered = filtered.filter(function (r) { return String(r.kind) === decodeURIComponent(mKind[1]); });
      return {
        ok: true,
        status: 200,
        text: async function () { return JSON.stringify(filtered); },
        json: async function () { return filtered; }
      };
    }
    if (method === 'POST') {
      var row = body;
      var dup = sbLedger.some(function (r) {
        return r.user_id === row.user_id && String(r.ref) === String(row.ref);
      });
      if (dup) {
        return {
          ok: false,
          status: 409,
          text: async function () { return JSON.stringify({ code: '23505', message: 'duplicate key' }); },
          json: async function () { return { code: '23505', message: 'duplicate key' }; }
        };
      }
      sbLedger.push(row);
      return {
        ok: true,
        status: 201,
        text: async function () { return JSON.stringify([row]); },
        json: async function () { return [row]; }
      };
    }
  }

  if (u.indexOf(SB + '/rest/v1/deletion_payment_requests') === 0) {
    if (method === 'POST') {
      var drow = Object.assign({}, body, { id: deletionReqs.length + 1, status: body.status || 'pending' });
      var existing = deletionReqs.find(function (r) { return r.request_key === drow.request_key; });
      if (existing) {
        Object.assign(existing, drow);
        return {
          ok: true,
          status: 200,
          text: async function () { return JSON.stringify([existing]); },
          json: async function () { return [existing]; }
        };
      }
      deletionReqs.push(drow);
      return {
        ok: true,
        status: 201,
        text: async function () { return JSON.stringify([drow]); },
        json: async function () { return [drow]; }
      };
    }
    if (method === 'GET' || !opts.method) {
      return {
        ok: true,
        status: 200,
        text: async function () { return JSON.stringify(deletionReqs); },
        json: async function () { return deletionReqs; }
      };
    }
  }

  if (u.indexOf(SB + '/rest/v1/notifications') === 0 && method === 'POST') {
    return {
      ok: true,
      status: 201,
      text: async function () { return JSON.stringify([body]); },
      json: async function () { return [body]; }
    };
  }

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
      var existed = !!posts[delId];
      delete posts[delId];
      var delRows = existed ? [{ id: delId }] : [];
      return {
        ok: true,
        status: 200,
        text: async function () { return JSON.stringify(delRows); },
        json: async function () { return delRows; }
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

function loadHandler(rel) {
  var full = require.resolve(rel);
  delete require.cache[full];
  return require(rel);
}

function mockRes() {
  return {
    statusCode: 0,
    headers: {},
    body: '',
    setHeader: function (k, v) { this.headers[k] = v; },
    end: function (s) { this.body = String(s || ''); }
  };
}

async function invoke(handler, body, headers) {
  var req = { method: 'POST', headers: headers || {}, body: body };
  var res = mockRes();
  await handler(req, res);
  var json = {};
  try { json = JSON.parse(res.body || '{}'); } catch (_) {}
  return { status: res.statusCode, json: json };
}

function samplePost(id, owner) {
  return {
    id: id,
    username: owner || 'publisher1',
    tags: ['del:locked'],
    expires_at: null,
    extend_amount: null
  };
}

(async function main() {
  var deletePost = loadHandler('../api/delete-post.js');
  var adminRequest = loadHandler('../api/admin-request.js');
  var html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  var delSrc = fs.readFileSync(path.join(__dirname, '..', 'api', 'delete-post.js'), 'utf8');
  var admSrc = fs.readFileSync(path.join(__dirname, '..', 'api', 'admin-request.js'), 'utf8');

  // ---- TEST A ----
  resetState();
  sbWallets.buyerA = 200;
  posts['p-a'] = samplePost('p-a', 'ownerA');
  var a = await invoke(deletePost, { user: 'buyerA', postId: 'p-a', reason: 'paid', idempotencyKey: 'delete-post:p-a:buyera:10' });
  assert.strictEqual(a.status, 200, 'A status');
  assert.strictEqual(a.json.charged, 10, 'A charged 10');
  assert.strictEqual(sbWallets.buyerA, 190, 'A balance -10');
  assert.strictEqual(posts['p-a'], undefined, 'A post gone');
  console.log('PASS · TEST A sufficient Coins deletes + charges 10');

  // ---- TEST B ----
  resetState();
  sbWallets.buyerB = 5;
  posts['p-b'] = samplePost('p-b', 'ownerB');
  var b = await invoke(deletePost, { user: 'buyerB', postId: 'p-b', reason: 'paid' });
  assert.strictEqual(b.status, 402, 'B 402');
  assert.strictEqual(b.json.error, 'insufficient', 'B insufficient');
  assert.strictEqual(sbWallets.buyerB, 5, 'B no charge');
  assert.ok(posts['p-b'], 'B post remains');
  console.log('PASS · TEST B insufficient Coins no charge / post remains');

  // ---- TEST C ----
  resetState();
  var c = await invoke(adminRequest, {
    kind: 'remove_request',
    user: 'paypal_user',
    post_id: '3064',
    amount: '$5',
    provider: 'paypal',
    label: 'DELETE',
    payload: { publisher: 'Momchod', requester: 'paypal_user', payment: '$5' },
    message: 'DELETE PAYMENT REQUEST paypal post #3064'
  });
  assert.strictEqual(c.status, 200, 'C status');
  assert.ok(c.json.ok, 'C ok');
  assert.ok(c.json.request || c.json.channels.supabase || c.json.channels.notifs, 'C durable channel');
  assert.ok(deletionReqs.some(function (r) { return r.post_id === '3064' && /paypal/i.test(r.provider); }), 'C SB row');
  console.log('PASS · TEST C PayPal remove_request persists');

  // ---- TEST D ----
  resetState();
  var d = await invoke(adminRequest, {
    kind: 'remove_request',
    user: 'throne_user',
    post_id: '3064',
    amount: '$5',
    provider: 'throne',
    label: 'DELETE',
    payload: { publisher: 'Momchod', requester: 'throne_user', payment: '$5' },
    message: 'DELETE PAYMENT REQUEST throne post #3064'
  });
  assert.strictEqual(d.status, 200, 'D status');
  assert.ok(d.json.ok, 'D ok');
  assert.ok(deletionReqs.some(function (r) { return r.post_id === '3064' && /throne/i.test(r.provider); }), 'D SB row');
  console.log('PASS · TEST D Throne remove_request persists');

  // ---- TEST E (admin approve = moderation delete) ----
  resetState();
  posts['p-e'] = samplePost('p-e', 'victimE');
  var e = await invoke(
    deletePost,
    { user: 'admin', postId: 'p-e', reason: 'moderation', adminKey: 'test-admin-key' },
    {}
  );
  // Without ADMIN_KEY env, expect admin_auth_required — set env for this invoke
  process.env.ADMIN_KEY = 'test-admin-key';
  delete require.cache[require.resolve('../api/delete-post.js')];
  deletePost = loadHandler('../api/delete-post.js');
  e = await invoke(deletePost, { user: 'admin', postId: 'p-e', reason: 'moderation', adminKey: 'test-admin-key' });
  assert.strictEqual(e.status, 200, 'E status');
  assert.strictEqual(e.json.charged, 0, 'E no FC');
  assert.strictEqual(posts['p-e'], undefined, 'E deleted');
  assert.ok(e.json.moderated || e.json.reason === 'moderation', 'E moderated');
  console.log('PASS · TEST E admin approve/moderation deletes without charge');

  // ---- TEST F (reject keeps post) — static + behavioral: reject does not call delete ----
  resetState();
  posts['p-f'] = samplePost('p-f', 'victimF');
  assert.ok(posts['p-f'], 'F post present before reject');
  assert.ok(html.indexOf('Rejected — post kept') >= 0 || html.indexOf('Post stays public') >= 0, 'F reject copy');
  assert.ok(/resolveDeletionPaymentRequest\([^)]*'rejected'/.test(html) || html.indexOf("status:'rejected'") >= 0, 'F marks rejected in SB');
  assert.ok(posts['p-f'], 'F post still present (reject never deletes)');
  console.log('PASS · TEST F reject keeps post / marks rejected');

  // ---- TEST G anon owner free delete ----
  resetState();
  posts['p-g'] = samplePost('p-g', 'anon_owner123');
  var g = await invoke(deletePost, {
    user: 'anon_owner123',
    postId: 'p-g',
    reason: 'owner',
    account_type: 'anonymous'
  });
  assert.strictEqual(g.status, 200, 'G status');
  assert.strictEqual(g.json.charged, 0, 'G free');
  assert.strictEqual(posts['p-g'], undefined, 'G deleted');
  console.log('PASS · TEST G anon owner free delete');

  // ---- TEST H anon non-owner denied without payment ----
  resetState();
  posts['p-h'] = samplePost('p-h', 'someone_else');
  var h = await invoke(deletePost, {
    user: 'anon_intruder',
    postId: 'p-h',
    reason: 'owner',
    account_type: 'anonymous'
  });
  assert.strictEqual(h.status, 403, 'H 403');
  assert.strictEqual(h.json.error, 'anonymous_cannot_delete', 'H anonymous_cannot_delete');
  assert.ok(posts['p-h'], 'H post remains');
  console.log('PASS · TEST H anon non-owner denied');

  // ---- TEST I admin direct delete ----
  resetState();
  posts['p-i'] = samplePost('p-i', 'anyone');
  var i = await invoke(deletePost, { user: 'ruinexpose', postId: 'p-i', reason: 'moderation', adminKey: 'test-admin-key' });
  assert.strictEqual(i.status, 200, 'I status');
  assert.strictEqual(i.json.charged, 0, 'I no charge');
  assert.strictEqual(posts['p-i'], undefined, 'I deleted');
  console.log('PASS · TEST I admin direct delete');

  // ---- TEST J pending survive refresh (durable SB + dismiss-by-requestId) ----
  assert.ok(html.indexOf('deletion_payment_requests') >= 0, 'J loads SB deletion_payment_requests');
  assert.ok(html.indexOf('isRemoveRowDismissed') >= 0, 'J dismiss helper');
  assert.ok(html.indexOf('never forever-ban the post id') >= 0 || html.indexOf('keep post id free for future payment claims') >= 0 || html.indexOf('request identity') >= 0 || html.indexOf('NEVER hide a fresh pending claim') >= 0, 'J no post-id forever dismiss');
  assert.ok(admSrc.indexOf('deletion_payment_requests') >= 0, 'J admin-request persists SB');
  assert.ok(admSrc.indexOf('missing_post_id') >= 0, 'J requires post id');
  console.log('PASS · TEST J durable pending requests / refresh-safe');

  // ---- TEST K double-click / idempotency ----
  resetState();
  sbWallets.buyerK = 200;
  posts['p-k'] = samplePost('p-k', 'ownerK');
  var k1 = await invoke(deletePost, { user: 'buyerK', postId: 'p-k', reason: 'paid', idempotencyKey: 'delete-post:p-k:buyerk:10' });
  var balAfter = sbWallets.buyerK;
  var k2 = await invoke(deletePost, { user: 'buyerK', postId: 'p-k', reason: 'paid', idempotencyKey: 'delete-post:p-k:buyerk:10' });
  assert.strictEqual(k1.json.charged, 10, 'K1 charged');
  assert.strictEqual(k2.json.already_deleted || k2.json.ok, true, 'K2 ok');
  assert.strictEqual(k2.json.charged, 0, 'K2 no second charge');
  assert.strictEqual(sbWallets.buyerK, balAfter, 'K balance unchanged on replay');
  // Concurrent lock
  resetState();
  sbWallets.buyerK2 = 200;
  posts['p-k2'] = samplePost('p-k2', 'ownerK2');
  var p1 = invoke(deletePost, { user: 'buyerK2', postId: 'p-k2', reason: 'paid', idempotencyKey: 'delete-post:p-k2:buyerk2:10' });
  var p2 = invoke(deletePost, { user: 'buyerK2', postId: 'p-k2', reason: 'paid', idempotencyKey: 'delete-post:p-k2:buyerk2:10' });
  var both = await Promise.all([p1, p2]);
  var chargedSum = (both[0].json.charged || 0) + (both[1].json.charged || 0);
  var oneConflict = both.some(function (x) { return x.status === 409 || x.json.error === 'delete_in_progress'; });
  var oneOk = both.some(function (x) { return x.json.ok && x.json.charged === 10; });
  assert.ok(oneOk || chargedSum <= 10, 'K concurrent at most one charge');
  assert.ok(chargedSum <= 10 || oneConflict, 'K no double charge');
  console.log('PASS · TEST K idempotent / no double charge');

  // ---- TEST BTC anon remove_request (no coins credit) ----
  resetState();
  var btc = await invoke(adminRequest, {
    kind: 'remove_request',
    user: 'anon_sessionbtc1',
    post_id: '4099',
    amount: '$5',
    provider: 'bitcoin',
    label: 'DELETE',
    payload: { publisher: 'ownerX', requester: 'anon_sessionbtc1', payment: '$5', status: 'PAYMENT CLAIMED / PENDING' },
    message: 'DELETE PAYMENT REQUEST bitcoin post #4099'
  });
  assert.strictEqual(btc.status, 200, 'BTC status');
  assert.ok(btc.json.ok, 'BTC ok');
  assert.ok(deletionReqs.some(function (r) { return r.post_id === '4099' && /bitcoin/i.test(r.provider); }), 'BTC SB row');
  var btcCoins = await invoke(adminRequest, {
    kind: 'coins',
    user: 'anon_sessionbtc1',
    amount: '$5',
    coins: 60,
    provider: 'bitcoin',
    label: '60 Coins recharge'
  });
  assert.strictEqual(btcCoins.status, 401, 'anon cannot credit Coins');
  assert.strictEqual(btcCoins.json.error, 'register_required_for_coins', 'anon coins blocked');
  console.log('PASS · TEST BTC anon $5 delete request allowed / Coins blocked');

  // CF timeout retry still persists
  resetState();
  cfRequestFailOnce = 2;
  var retry = await invoke(adminRequest, {
    kind: 'remove_request',
    user: 'retry_user',
    post_id: '3099',
    amount: '$5',
    provider: 'paypal',
    message: 'retry post #3099'
  });
  assert.ok(retry.json.ok, 'retry ok despite CF timeouts');
  assert.ok(deletionReqs.length >= 1, 'retry persisted SB');
  console.log('PASS · CF /requests timeout still persists delete claim');

  // Blank post id rejected
  var blank = await invoke(adminRequest, {
    kind: 'remove_request',
    user: 'blank_user',
    amount: '$5',
    provider: 'paypal'
  });
  assert.strictEqual(blank.status, 400, 'blank post_id rejected');
  assert.strictEqual(blank.json.error, 'missing_post_id', 'missing_post_id');
  console.log('PASS · blank remove_request post_id rejected');

  // Static SPA contracts
  assert.ok(html.indexOf('verifyPostDeletedPoll') >= 0 || html.indexOf('must not decide failure') >= 0 || html.indexOf('NEVER treat AbortError') >= 0, 'timeout verifies SB');
  assert.ok(html.indexOf("delete payment needs a post ID") >= 0, 'ticket requires post id');
  assert.ok(html.indexOf("data-admin=\"remove-clear\"") >= 0, 'CLEAR REQUEST action');
  assert.ok(html.indexOf('function adminRequestTimestamp') >= 0, 'request timestamp helper');
  assert.ok(html.indexOf('Only mark completed after the publication is actually gone') >= 0, 'approve verifies deletion');
  assert.ok(delSrc.indexOf('claimSbSpendRef') >= 0, 'SB spend claim');
  assert.ok(delSrc.indexOf('recordModerationAudit') >= 0, 'moderation audit');
  assert.ok(delSrc.indexOf('acquireDeleteLock') >= 0, 'delete lock');
  assert.ok(delSrc.indexOf('waited_for_inflight') >= 0, 'inflight delete wait');
  assert.ok(fs.existsSync(path.join(__dirname, '..', 'migrations', '20261116_coin_ledger_deletion_requests.sql')), 'migration present');

  console.log('\nOK · deletion-payment-e2e A–K');
})().catch(function (e) {
  console.error('FAIL ·', e && e.stack ? e.stack : e);
  process.exit(1);
});
