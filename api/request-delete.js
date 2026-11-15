/**
 * Atomic FC-paid deletion REQUEST (does NOT auto-delete the post).
 *
 * POST /api/request-delete
 * Body: { user, postId, idempotencyKey? }
 *   → spend 50 FC (server price) + create remove_request + notify admins
 *   → if request channels all fail after a NEW spend, refund the 50 FC
 *
 * POST /api/request-delete  action=approve|reject|refund
 *   → admin-only (ADMIN_KEY or CF admin bearer). Approve deletes via same
 *     path as /api/delete-post moderation. Reject can refund once.
 *
 * GET /api/request-delete?user=&postId=
 *   → lookup pending/completed status for that user+post (best-effort).
 *
 * Never trusts client balance / coins. Reuses CF wallet ledger + /requests.
 */
'use strict';

const CF_API = process.env.CF_API || 'https://ruiningsubs-api.0788adm.workers.dev';
const SITE = process.env.SITE_URL || 'https://www.ruinexpose.com';
const DELETE_COST_FC = Number(process.env.FC_COST_DELETE || 50) || 50;
const ADMIN_ALIASES = ['admin', 'MasterSan', 'mastersan', 'mastersan01'];

let createClient = null;
try {
  createClient = require('@supabase/supabase-js').createClient;
} catch (_) {
  createClient = null;
}

// Best-effort in-process idempotency / double-click lock (serverless).
var recentRequests = new Map();
var locks = new Map();

function json(res, code, body) {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Idempotency-Key');
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise(function (resolve, reject) {
    if (req.body && typeof req.body === 'object') return resolve(req.body);
    var chunks = [];
    req.on('data', function (c) {
      chunks.push(c);
    });
    req.on('end', function () {
      try {
        var raw = Buffer.concat(chunks).toString('utf8') || '{}';
        resolve(JSON.parse(raw));
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

function normUser(u) {
  return String(u || '')
    .trim()
    .replace(/^@+/, '')
    .toLowerCase()
    .slice(0, 40);
}

function bearerToken(req) {
  var h = String((req.headers && (req.headers.authorization || req.headers.Authorization)) || '');
  var m = h.match(/^Bearer\s+(.+)$/i);
  return m ? String(m[1] || '').trim() : '';
}

function adminKeyOk(provided) {
  var expected = String(process.env.ADMIN_KEY || process.env.RUIN_ADMIN_KEY || '').trim();
  if (!expected) return false;
  return String(provided || '').trim() === expected;
}

function sb() {
  if (!createClient) return null;
  var url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  var key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

async function cfFetch(path, opts, ms) {
  var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  var timer = null;
  if (ctrl) {
    timer = setTimeout(function () {
      try {
        ctrl.abort();
      } catch (e) {}
    }, ms || 14000);
  }
  try {
    var r = await fetch(
      CF_API + path,
      Object.assign(
        {
          cache: 'no-store',
          signal: ctrl ? ctrl.signal : undefined
        },
        opts || {}
      )
    );
    var j = await r.json().catch(function () {
      return {};
    });
    return { ok: r.ok, status: r.status, json: j };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function verifyCfAdminToken(token) {
  if (!token) return false;
  try {
    var res = await cfFetch('/admin/requests?limit=1', {
      headers: { Authorization: 'Bearer ' + token, Origin: SITE }
    });
    return !!(res.ok && res.json && res.json.ok !== false);
  } catch (_) {
    return false;
  }
}

function spendRef(user, postId) {
  return ('remove-req:' + String(postId) + ':' + String(user)).slice(0, 120);
}

function refundRef(user, postId) {
  return ('remove-refund:' + String(postId) + ':' + String(user)).slice(0, 120);
}

async function findLedgerRow(user, kind, action, ref, minCoins) {
  var res = await cfFetch('/wallet/ledger?user=' + encodeURIComponent(user));
  var rows = (res.json && res.json.ledger) || [];
  for (var i = 0; i < rows.length; i++) {
    var row = rows[i] || {};
    if (kind && String(row.kind || '') !== String(kind)) continue;
    if (action && String(row.action || '') !== String(action)) continue;
    if (String(row.ref_id || row.ref || '') !== String(ref || '')) continue;
    if (minCoins != null && Number(row.coins || 0) < Number(minCoins || 0)) continue;
    return row;
  }
  return null;
}

async function spendDeleteRequestFc(user, postId, idemRef) {
  var action = 'delete';
  var cost = DELETE_COST_FC;
  var ref = String(idemRef || spendRef(user, postId)).slice(0, 120);

  var existing = await findLedgerRow(user, 'spend', action, ref, cost);
  if (existing) {
    return { ok: true, reused: true, balance: null, coins: cost, ref: ref, ledger: existing };
  }

  var res = await cfFetch('/wallet', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: SITE },
    body: JSON.stringify({ user: user, spend: cost, action: action, ref: ref })
  });

  if (res.json && res.json.ok) {
    return {
      ok: true,
      reused: false,
      balance: res.json.balance != null ? Number(res.json.balance) : null,
      coins: cost,
      ref: ref,
      spend: res.json
    };
  }

  var err = String((res.json && (res.json.error || res.json.message)) || '');
  if (/insufficient|not enough|balance/i.test(err) || res.status === 402 || res.status === 400) {
    return {
      ok: false,
      error: 'insufficient',
      need: cost,
      balance: Number((res.json && res.json.balance) || 0) || 0,
      ref: ref
    };
  }
  return { ok: false, error: err || 'spend_failed', status: res.status, ref: ref };
}

async function refundDeleteRequestFc(user, postId, adminToken) {
  var ref = refundRef(user, postId);
  var existing = await findLedgerRow(user, null, 'delete_request_refund', ref, DELETE_COST_FC);
  if (existing) {
    return { ok: true, reused: true, balance: null, coins: DELETE_COST_FC, ref: ref };
  }
  // Also treat generic credit with same ref as already refunded.
  var existingAdd = await findLedgerRow(user, 'add', null, ref, DELETE_COST_FC);
  if (existingAdd) {
    return { ok: true, reused: true, balance: null, coins: DELETE_COST_FC, ref: ref };
  }

  var body = JSON.stringify({
    user: user,
    add: DELETE_COST_FC,
    action: 'delete_request_refund',
    ref: ref,
    admin: true
  });
  var headers = { 'Content-Type': 'application/json', Origin: SITE };
  if (adminToken) headers.Authorization = 'Bearer ' + adminToken;

  var res = await cfFetch('/wallet', { method: 'POST', headers: headers, body: body });
  if (res.json && res.json.ok) {
    return {
      ok: true,
      reused: false,
      balance: res.json.balance != null ? Number(res.json.balance) : null,
      coins: DELETE_COST_FC,
      ref: ref
    };
  }

  // Retry with admin bearer if first attempt lacked it / was unauthorized.
  if (!adminToken || res.status === 401 || res.status === 403) {
    return {
      ok: false,
      error: (res.json && (res.json.error || res.json.message)) || 'refund_failed',
      status: res.status,
      ref: ref,
      need_admin: true
    };
  }
  return {
    ok: false,
    error: (res.json && (res.json.error || res.json.message)) || 'refund_failed',
    status: res.status,
    ref: ref
  };
}

async function loadPostMeta(postId) {
  var client = sb();
  if (!client) return null;
  try {
    var q = await client
      .from('posts')
      .select('id,username,title,thumb_url,media_url,created_at,tags')
      .eq('id', postId)
      .maybeSingle();
    if (q.error && /thumb_url|media_url/i.test(String(q.error.message || ''))) {
      q = await client
        .from('posts')
        .select('id,username,title,created_at,tags')
        .eq('id', postId)
        .maybeSingle();
    }
    if (q.error) return null;
    return q.data || null;
  } catch (_) {
    return null;
  }
}

async function createRemoveRequest(payload) {
  var res = await cfFetch(
    '/requests',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: SITE },
      body: JSON.stringify(payload)
    },
    14000
  );
  if (res.ok && res.json && res.json.ok !== false) {
    return {
      ok: true,
      duplicate: !!res.json.duplicate,
      request: res.json.request || res.json
    };
  }
  return {
    ok: false,
    error: (res.json && res.json.error) || 'cf_request_http_' + res.status,
    status: res.status
  };
}

async function postNotif(to, from, type, postId, message) {
  var res = await cfFetch(
    '/notifs',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: SITE },
      body: JSON.stringify({
        to: to,
        to_username: to,
        from: from,
        from_username: from,
        type: type,
        post_id: postId || '',
        message: message
      })
    },
    10000
  );
  return {
    to: to,
    ok: !!(res.ok && res.json && res.json.ok !== false),
    status: res.status,
    error: res.json && res.json.error
  };
}

async function fanoutAdminNotifs(user, postId, message) {
  var results = [];
  for (var i = 0; i < ADMIN_ALIASES.length; i++) {
    try {
      results.push(await postNotif(ADMIN_ALIASES[i], user, 'remove_request', postId, message));
    } catch (e) {
      results.push({ to: ADMIN_ALIASES[i], ok: false, error: String((e && e.message) || e).slice(0, 120) });
    }
  }
  return results;
}

async function findPendingRemoveRequest(postId, user) {
  try {
    var res = await cfFetch(
      '/admin/requests?status=pending&kind=remove_request&limit=150',
      { headers: { Origin: SITE } },
      10000
    );
    var rows = (res.json && (res.json.requests || res.json.rows || res.json.items)) || [];
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i] || {};
      if (String(r.post_id || r.postId || '') !== String(postId)) continue;
      if (user && normUser(r.user_id || r.user || '') !== normUser(user)) continue;
      return r;
    }
  } catch (_) {}
  return null;
}

async function approveDeletePost(postId, adminUser, adminKey, adminToken) {
  // Delegate to the same secure delete path used by moderation.
  var deleteHandler = null;
  try {
    deleteHandler = require('./delete-post');
  } catch (_) {
    deleteHandler = null;
  }
  if (!deleteHandler) {
    return { ok: false, error: 'delete_handler_missing' };
  }

  var captured = null;
  var fakeRes = {
    statusCode: 200,
    setHeader: function () {},
    end: function (raw) {
      try {
        captured = JSON.parse(String(raw || '{}'));
      } catch (_) {
        captured = { ok: false, error: 'bad_delete_response' };
      }
    }
  };
  var fakeReq = {
    method: 'POST',
    headers: adminToken ? { authorization: 'Bearer ' + adminToken } : {},
    body: {
      user: adminUser || 'admin',
      postId: postId,
      reason: 'moderation',
      adminKey: adminKey || undefined,
      idempotencyKey: 'admin-approve-delete:' + postId
    }
  };
  await deleteHandler(fakeReq, fakeRes);
  return captured || { ok: false, error: 'delete_no_response' };
}

async function handleCreateRequest(req, res, body) {
  var user = normUser(body.user || body.username || body.user_id);
  var postId = String(body.postId || body.post_id || body.id || '').trim();
  var idem =
    String(
      body.idempotencyKey ||
        body.idempotency_key ||
        body.ref ||
        (req.headers && (req.headers['idempotency-key'] || req.headers['Idempotency-Key'])) ||
        ''
    ).trim() || spendRef(user, postId);

  if (!user || user === 'anon' || user === 'guest') {
    return json(res, 401, { ok: false, error: 'login_required' });
  }
  if (!postId) {
    return json(res, 400, { ok: false, error: 'missing_post_id' });
  }

  var cacheKey = user + '|' + postId + '|' + idem;
  var cached = recentRequests.get(cacheKey);
  if (cached && Date.now() - cached.at < 10 * 60 * 1000) {
    return json(res, 200, Object.assign({ ok: true, reused: true }, cached.body));
  }
  if (locks.get(cacheKey)) {
    return json(res, 409, { ok: false, error: 'in_progress', message: 'Request already in progress' });
  }
  locks.set(cacheKey, Date.now());

  try {
    var postMeta = await loadPostMeta(postId);
    var publisher = normUser((postMeta && (postMeta.username || postMeta.user)) || '');
    var title = String((postMeta && postMeta.title) || '').slice(0, 120);
    var thumb = String((postMeta && (postMeta.thumb_url || postMeta.media_url)) || '');
    var createdAt = (postMeta && postMeta.created_at) || null;

    // 1) Charge 50 FC (idempotent). Never trust client coins/balance.
    var spend = await spendDeleteRequestFc(user, postId, idem);
    if (!spend.ok) {
      var code = spend.error || 'spend_failed';
      var status = code === 'insufficient' ? 402 : spend.status || 400;
      return json(res, status, {
        ok: false,
        error: code,
        need: spend.need || DELETE_COST_FC,
        balance: spend.balance,
        cost: DELETE_COST_FC,
        buyUrl: '/coins',
        stage: 'processing_payment'
      });
    }

    var amountLabel = DELETE_COST_FC + ' FC';
    var requestedAt = new Date().toISOString();
    var removeMsg =
      '🚨 DELETE FC REQUEST · requester @' +
      user +
      ' · publisher @' +
      (publisher || '?') +
      ' · post #' +
      postId +
      ' · ' +
      amountLabel +
      ' charged · pending admin verify · DO NOT auto-delete' +
      (title ? ' · ' + title.slice(0, 40) : '');

    var payload = {
      message: removeMsg,
      post_id: String(postId),
      product: 'Delete post',
      reason: 'paid',
      publisher: publisher,
      requester: user,
      payment: amountLabel,
      paidWithFc: true,
      coins: DELETE_COST_FC,
      auto_delete: false,
      status: 'PENDING',
      title: title,
      thumb_url: thumb,
      post_created_at: createdAt,
      requested_at: requestedAt,
      spend_ref: spend.ref
    };

    // 2) Create admin request + fan-out notifs.
    var requestOk = false;
    var duplicate = false;
    var request = null;
    var requestError = null;
    try {
      var creq = await createRemoveRequest({
        kind: 'remove_request',
        user_id: user,
        amount: amountLabel,
        coins: DELETE_COST_FC,
        post_id: String(postId),
        provider: 'fc',
        label: 'DELETE',
        payload: payload
      });
      if (creq.ok) {
        requestOk = true;
        duplicate = !!creq.duplicate;
        request = creq.request;
      } else {
        requestError = creq.error || 'request_failed';
      }
    } catch (e) {
      requestError = String((e && e.message) || e).slice(0, 160);
    }

    var notifResults = await fanoutAdminNotifs(user, postId, removeMsg);
    var notifOk = notifResults.some(function (x) {
      return x && x.ok;
    });

    // 3) If BOTH channels failed after a NEW charge → refund so balance stays consistent.
    if (!requestOk && !notifOk) {
      var refund = null;
      if (!spend.reused) {
        try {
          refund = await refundDeleteRequestFc(user, postId, null);
        } catch (e) {
          refund = { ok: false, error: String((e && e.message) || e) };
        }
      }
      return json(res, 502, {
        ok: false,
        error: 'request_failed',
        detail: requestError || 'all_channels_failed',
        charged: spend.reused ? 0 : DELETE_COST_FC,
        refunded: !!(refund && refund.ok),
        refund: refund,
        balance: refund && refund.balance != null ? refund.balance : spend.balance,
        stage: 'sending_request'
      });
    }

    var out = {
      ok: true,
      status: 'PENDING',
      stage: 'request_submitted',
      message:
        '50 FC charged successfully. Your deletion request has been sent to the administrator.',
      charged: spend.reused ? 0 : DELETE_COST_FC,
      coins: DELETE_COST_FC,
      reused: !!spend.reused,
      balance: spend.balance,
      postId: String(postId),
      user: user,
      publisher: publisher,
      title: title,
      thumb_url: thumb,
      post_created_at: createdAt,
      requested_at: requestedAt,
      amount: amountLabel,
      request: request,
      duplicate: duplicate || !!spend.reused,
      channels: { request: requestOk, notifs: notifOk },
      notifs: notifResults,
      request_error: requestError,
      spend_ref: spend.ref
    };

    recentRequests.set(cacheKey, { at: Date.now(), body: out });
    if (recentRequests.size > 400) {
      var now = Date.now();
      recentRequests.forEach(function (v, k) {
        if (now - v.at > 15 * 60 * 1000) recentRequests.delete(k);
      });
    }
    return json(res, 200, out);
  } catch (e) {
    console.error('request-delete', e);
    return json(res, 500, {
      ok: false,
      error: 'request_delete_failed',
      message: String((e && e.message) || e).slice(0, 200)
    });
  } finally {
    locks.delete(cacheKey);
  }
}

async function handleAdminAction(req, res, body) {
  var action = String(body.action || '')
    .trim()
    .toLowerCase();
  var postId = String(body.postId || body.post_id || body.id || '').trim();
  var requester = normUser(body.requester || body.user || body.user_id || '');
  var adminUser = normUser(body.adminUser || body.admin_user || 'admin');
  var doRefund = body.refund === true || body.refund === 'true' || body.refund === 1 || action === 'refund';

  if (!postId && action !== 'refund') {
    return json(res, 400, { ok: false, error: 'missing_post_id' });
  }

  var token = bearerToken(req);
  var keyOk = adminKeyOk(body.adminKey);
  var cfOk = false;
  try {
    cfOk = await verifyCfAdminToken(token);
  } catch (_) {
    cfOk = false;
  }
  if (!keyOk && !cfOk) {
    return json(res, 401, { ok: false, error: 'admin_required' });
  }

  if (action === 'approve') {
    var del = await approveDeletePost(postId, adminUser, body.adminKey, token);
    if (!del || !del.ok) {
      return json(res, del && del.error === 'not_found' ? 404 : 500, {
        ok: false,
        error: (del && del.error) || 'approve_delete_failed',
        detail: del
      });
    }
    // Best-effort: mark matching CF request rejected/closed so it leaves pending.
    try {
      var pending = await findPendingRemoveRequest(postId, requester || null);
      if (pending && pending.id && token) {
        await cfFetch('/requests/' + encodeURIComponent(String(pending.id)) + '/reject', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer ' + token,
            Origin: SITE
          },
          body: JSON.stringify({
            admin_user: adminUser || 'admin',
            reason: 'Approved & deleted by ' + (adminUser || 'admin')
          })
        });
      }
    } catch (_) {}

    return json(res, 200, {
      ok: true,
      status: 'COMPLETED',
      action: 'approve',
      postId: postId,
      admin: adminUser,
      delete: del
    });
  }

  if (action === 'reject' || action === 'refund') {
    var refundResult = null;
    if (doRefund || action === 'refund') {
      if (!requester) {
        return json(res, 400, { ok: false, error: 'missing_requester_for_refund' });
      }
      refundResult = await refundDeleteRequestFc(requester, postId, token);
      if (!refundResult.ok) {
        return json(res, 502, {
          ok: false,
          error: 'refund_failed',
          detail: refundResult,
          status: 'REJECTED'
        });
      }
    }

    if (action === 'reject') {
      try {
        var pend = await findPendingRemoveRequest(postId, requester || null);
        if (pend && pend.id && token) {
          await cfFetch('/requests/' + encodeURIComponent(String(pend.id)) + '/reject', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: 'Bearer ' + token,
              Origin: SITE
            },
            body: JSON.stringify({
              admin_user: adminUser || 'admin',
              reason: 'Rejected by ' + (adminUser || 'admin') + (refundResult ? ' · refunded' : '')
            })
          });
        }
      } catch (_) {}
    }

    return json(res, 200, {
      ok: true,
      status: 'REJECTED',
      action: action,
      postId: postId,
      admin: adminUser,
      refunded: !!(refundResult && refundResult.ok),
      refund_reused: !!(refundResult && refundResult.reused),
      balance: refundResult && refundResult.balance,
      refund: refundResult
    });
  }

  return json(res, 400, { ok: false, error: 'unknown_action', allowed: ['approve', 'reject', 'refund'] });
}

async function handleStatus(req, res) {
  var q = req.query || {};
  // Vercel/Node may not populate req.query — parse URL.
  try {
    var u = new URL(req.url || '', 'http://localhost');
    q = Object.assign({}, q, Object.fromEntries(u.searchParams.entries()));
  } catch (_) {}
  var user = normUser(q.user || q.username);
  var postId = String(q.postId || q.post_id || '').trim();
  if (!user || !postId) {
    return json(res, 400, { ok: false, error: 'missing_user_or_post' });
  }

  var spend = await findLedgerRow(user, 'spend', 'delete', spendRef(user, postId), DELETE_COST_FC);
  var refund = await findLedgerRow(user, null, 'delete_request_refund', refundRef(user, postId), DELETE_COST_FC);
  var pending = null;
  try {
    pending = await findPendingRemoveRequest(postId, user);
  } catch (_) {}

  var status = 'NONE';
  if (refund) status = 'REJECTED';
  else if (pending) status = 'PENDING';
  else if (spend) status = 'SUBMITTED';

  return json(res, 200, {
    ok: true,
    status: status,
    postId: postId,
    user: user,
    charged: !!spend,
    refunded: !!refund,
    pending: pending,
    cost: DELETE_COST_FC
  });
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Idempotency-Key');
    return res.end();
  }
  if (req.method === 'GET') return handleStatus(req, res);
  if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'method_not_allowed' });

  var body;
  try {
    body = await readBody(req);
  } catch (e) {
    return json(res, 400, { ok: false, error: 'invalid_json' });
  }

  var action = String(body.action || '')
    .trim()
    .toLowerCase();
  if (action === 'approve' || action === 'reject' || action === 'refund') {
    return handleAdminAction(req, res, body);
  }
  return handleCreateRequest(req, res, body);
};
