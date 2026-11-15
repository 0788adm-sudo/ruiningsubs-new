#!/usr/bin/env node
/**
 * Behavioral proof: /api/delete-post reason=paid charges once, deletes the row,
 * never hits admin request/notif endpoints, and refunds if delete fails.
 */
'use strict';

var assert = require('assert');
var path = require('path');
var Module = require('module');

var CF = 'https://ruiningsubs-api.0788adm.workers.dev';
var SB = 'https://snlpdolzhzcbbdyxqlnb.supabase.co';
var calls = [];
var walletBalance = 500;
var posts = {
  'post-fc-1': {
    id: 'post-fc-1',
    username: 'publisher1',
    tags: ['del:deletable'],
    expires_at: null,
    extend_amount: null,
    deletion_tier: 'deletable',
    free_deletion_enabled: true,
    owner_token_hash: null
  }
};
var ledger = [];
var forceDeleteFail = false;

function record(kind, url, body) {
  calls.push({ kind: kind, url: String(url || ''), body: body || null });
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
    return {
      ok: true,
      status: 200,
      json: async function () {
        return { ok: true, ledger: ledger.slice() };
      }
    };
  }

  if (u === CF + '/wallet' && method === 'POST') {
    if (body && body.spend) {
      var spend = Number(body.spend) || 0;
      if (walletBalance < spend) {
        return {
          ok: false,
          status: 402,
          json: async function () {
            return { ok: false, error: 'insufficient', balance: walletBalance };
          }
        };
      }
      walletBalance -= spend;
      ledger.unshift({
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
          return { ok: true, balance: walletBalance };
        }
      };
    }
    if (body && body.add) {
      walletBalance += Number(body.add) || 0;
      ledger.unshift({
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
          return { ok: true, balance: walletBalance };
        }
      };
    }
  }

  if (u.indexOf(CF + '/posts/') === 0 && method === 'DELETE') {
    return {
      ok: true,
      status: 200,
      json: async function () {
        return { ok: true };
      }
    };
  }

  if (u.indexOf(CF + '/admin/requests') === 0) {
    return {
      ok: true,
      status: 200,
      json: async function () {
        return { ok: true, requests: [] };
      }
    };
  }

  // Supabase REST
  if (u.indexOf(SB + '/rest/v1/posts') === 0) {
    if (method === 'GET' || method === 'HEAD' || !opts.method) {
      var idMatch = u.match(/id=eq\.([^&]+)/);
      var id = idMatch ? decodeURIComponent(idMatch[1]) : '';
      var row = posts[id] || null;
      var text = JSON.stringify(row ? [row] : []);
      return {
        ok: true,
        status: 200,
        text: async function () {
          return text;
        },
        json: async function () {
          return row ? [row] : [];
        }
      };
    }
    if (method === 'DELETE') {
      if (forceDeleteFail) {
        return {
          ok: false,
          status: 500,
          text: async function () {
            return JSON.stringify({ message: 'forced_fail' });
          },
          json: async function () {
            return { message: 'forced_fail' };
          }
        };
      }
      var delMatch = u.match(/id=eq\.([^&]+)/);
      var delId = delMatch ? decodeURIComponent(delMatch[1]) : '';
      delete posts[delId];
      return {
        ok: true,
        status: 200,
        text: async function () {
          return '[]';
        },
        json: async function () {
          return [];
        }
      };
    }
  }

  // Anything else (cache purge, etc.) — ignore quietly
  return {
    ok: true,
    status: 200,
    text: async function () {
      return '{}';
    },
    json: async function () {
      return {};
    }
  };
};

// Force REST path (no @supabase client) so the fallback is exercised.
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
    setHeader: function (k, v) {
      this.headers[k] = v;
    },
    end: function (s) {
      this.body = String(s || '');
    }
  };
}

async function invoke(body) {
  var req = {
    method: 'POST',
    headers: {},
    body: body
  };
  var res = mockRes();
  await handler(req, res);
  var json = {};
  try {
    json = JSON.parse(res.body || '{}');
  } catch (_) {}
  return { status: res.statusCode, json: json };
}

function noAdminTraffic() {
  return calls.every(function (c) {
    var u = c.url;
    var body = c.body || {};
    // Pin-board cleanup after delete is allowed (not an admin delete request).
    if (/\/notifs/.test(u)) {
      var to = String(body.to_username || '');
      if (to === '__PIN_BOARD__' || to === '__PIN_REWARDS__') return true;
      if (/notifs\?to=__PIN_/.test(u)) return true;
      if (/\/notifs\/[^?]+$/.test(u) && c.kind === 'DELETE') return true;
      // Any other notif POST would be an admin/user notify — forbidden for FC auto-delete.
      if (c.kind === 'POST') return false;
      return true;
    }
    if (/\/admin\/requests/.test(u) && c.kind === 'GET') return true;
    if (/\/requests/.test(u) && c.kind === 'POST') return false;
    if (/admin-request/.test(u)) return false;
    if (body && body.kind === 'remove_request') return false;
    if (body && /DELETE FC REQUEST|pending admin verify/i.test(String(body.message || ''))) return false;
    return true;
  });
}

(async function main() {
  // 1) Happy path: charge + delete, no admin
  calls = [];
  walletBalance = 500;
  ledger = [];
  posts['post-fc-1'] = {
    id: 'post-fc-1',
    username: 'publisher1',
    tags: ['del:deletable'],
    expires_at: null,
    extend_amount: null,
    deletion_tier: 'deletable',
    free_deletion_enabled: true,
    owner_token_hash: null
  };
  forceDeleteFail = false;

  var r1 = await invoke({
    user: 'buyer1',
    postId: 'post-fc-1',
    reason: 'paid',
    idempotencyKey: 'delete-post:post-fc-1:buyer1:50'
  });
  assert.strictEqual(r1.status, 200, 'paid delete status 200');
  assert.strictEqual(r1.json.ok, true, 'paid delete ok');
  assert.strictEqual(r1.json.charged, 50, 'charged exactly 50');
  assert.strictEqual(r1.json.admin_notified, false, 'admin_notified false');
  assert.strictEqual(r1.json.auto_deleted, true, 'auto_deleted true');
  assert.strictEqual(r1.json.reason, 'paid', 'reason paid');
  assert.strictEqual(walletBalance, 450, 'balance decreased by 50');
  assert.strictEqual(posts['post-fc-1'], undefined, 'post removed from DB');
  if (!noAdminTraffic()) {
    console.error('ADMIN LEAK CALLS', JSON.stringify(calls, null, 2));
  }
  assert.ok(noAdminTraffic(), 'no admin request/notif traffic on success');
  console.log('PASS · paid FC auto-delete removes post and skips admin');

  // 2) Idempotent re-entry after delete
  calls = [];
  var r2 = await invoke({
    user: 'buyer1',
    postId: 'post-fc-1',
    reason: 'paid',
    idempotencyKey: 'delete-post:post-fc-1:buyer1:50'
  });
  assert.strictEqual(r2.status, 200, 'already_deleted status');
  assert.strictEqual(r2.json.already_deleted, true, 'already_deleted flag');
  assert.strictEqual(r2.json.charged, 0, 'no second charge');
  assert.strictEqual(walletBalance, 450, 'balance unchanged on replay');
  console.log('PASS · idempotent already_deleted does not double-charge');

  // 3) Delete failure after NEW charge → refund
  calls = [];
  walletBalance = 200;
  ledger = [];
  posts['post-fc-2'] = {
    id: 'post-fc-2',
    username: 'publisher2',
    tags: ['del:locked'],
    expires_at: null,
    extend_amount: null,
    deletion_tier: 'locked',
    free_deletion_enabled: false,
    owner_token_hash: null
  };
  forceDeleteFail = true;
  var r3 = await invoke({
    user: 'buyer2',
    postId: 'post-fc-2',
    reason: 'paid',
    idempotencyKey: 'delete-post:post-fc-2:buyer2:50'
  });
  assert.strictEqual(r3.status, 500, 'delete_failed status');
  assert.strictEqual(r3.json.error, 'delete_failed', 'delete_failed error');
  assert.strictEqual(r3.json.refunded, true, 'refunded true');
  assert.strictEqual(walletBalance, 200, 'coins restored after failed delete');
  assert.ok(posts['post-fc-2'], 'post still present after failed delete');
  assert.ok(noAdminTraffic(), 'no admin traffic on refund path');
  console.log('PASS · failed delete refunds 50 FC and leaves post');

  // 4) Insufficient FC — no delete, no admin
  calls = [];
  forceDeleteFail = false;
  walletBalance = 10;
  ledger = [];
  posts['post-fc-3'] = {
    id: 'post-fc-3',
    username: 'publisher3',
    tags: ['del:deletable'],
    expires_at: null,
    extend_amount: null,
    deletion_tier: 'deletable',
    free_deletion_enabled: true,
    owner_token_hash: null
  };
  var r4 = await invoke({
    user: 'poor1',
    postId: 'post-fc-3',
    reason: 'paid'
  });
  assert.strictEqual(r4.status, 402, 'insufficient status');
  assert.strictEqual(r4.json.error, 'insufficient', 'insufficient error');
  assert.ok(posts['post-fc-3'], 'post not deleted on insufficient');
  assert.strictEqual(walletBalance, 10, 'balance unchanged when insufficient');
  assert.ok(noAdminTraffic(), 'no admin traffic on insufficient');
  console.log('PASS · insufficient FC blocks delete without admin notify');

  // 5) Static contract: package + REST fallback + no FC admin copy
  var fs = require('fs');
  var root = path.join(__dirname, '..');
  var pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  var html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  var api = fs.readFileSync(path.join(root, 'api', 'delete-post.js'), 'utf8');
  assert.ok(pkg.dependencies && pkg.dependencies['@supabase/supabase-js'], 'package.json includes @supabase/supabase-js');
  assert.ok(api.indexOf('sbRest') >= 0, 'delete-post has REST fallback');
  assert.ok(api.indexOf('admin_notified: false') >= 0, 'API never claims admin notify');
  assert.ok(html.indexOf('Post deleted successfully') >= 0, 'success copy');
  assert.ok(html.indexOf('Sending request to admin') < 0, 'no sending-to-admin copy');
  assert.ok(html.indexOf('admin will review (post stays up)') < 0, 'no admin-will-review FC toast');
  assert.ok(html.indexOf('DELETE FC REQUEST') < 0, 'no DELETE FC REQUEST admin message');
  assert.ok(html.indexOf("submitRemoveRequest blocked FC path") >= 0, 'FC blocked from submitRemoveRequest');
  assert.ok(html.indexOf("secureDeletePost(id,{reason:'paid'") >= 0, 'FC uses secureDeletePost paid');
  assert.ok(!fs.existsSync(path.join(root, 'api', 'request-delete.js')), 'request-delete.js absent');
  console.log('PASS · static FC auto-delete contract');

  console.log('OK · fc-autodelete-handler');
})().catch(function (e) {
  console.error('FAIL ·', e && e.stack ? e.stack : e);
  process.exit(1);
});
