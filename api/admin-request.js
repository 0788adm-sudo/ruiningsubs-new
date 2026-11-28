// Same-origin intake for Admin payment/remove/pin requests.
// Mobile Safari often fails direct browser → workers.dev ("Load failed").
// This proxy creates the CF /requests row AND fans out admin notifs so the
// inbox still gets the alert even if one channel flakes.
//
// For remove_request (PayPal/Throne $5 delete claims):
// - Requires a real post_id (never accept blank delete tickets)
// - Retries CF /requests on timeout
// - Persists a durable row in Supabase deletion_payment_requests when available
// - Never auto-verifies payment — status stays pending for admin review

const CF_API = process.env.CF_API || 'https://ruiningsubs-api.0788adm.workers.dev';
const SITE = process.env.SITE_URL || 'https://www.ruinexpose.com';
const SB_URL =
  process.env.SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.VITE_SUPABASE_URL ||
  'https://snlpdolzhzcbbdyxqlnb.supabase.co';
const SB_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNubHBkb2x6aHpjYmJkeXhxbG5iIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY1NTg0OTYsImV4cCI6MjEwMjEzNDQ5Nn0.sWbn1sLgG6vi6wzKxpW5-1Td47awaxhwA-4ixKXZN-E';

const ALLOWED_KINDS = {
  remove_request: 1,
  pin_payment_request: 1,
  coins: 1,
  page_request: 1,
  payment: 1,
  feature_request: 1,
  roulette_pack_request: 1,
  roulette_pack: 1,
  dice_pack_request: 1,
  dice_pack: 1,
  tic_tac_toe_pack_request: 1,
  triki_pack_request: 1,
  game_pack_request: 1
};

function json(res, code, body) {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise(function (resolve, reject) {
    if (req.body && typeof req.body === 'object') return resolve(req.body);
    var chunks = [];
    req.on('data', function (c) { chunks.push(c); });
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
  return String(u || '').replace(/^@/, '').trim().slice(0, 40);
}

function normKind(k) {
  return String(k || '').trim().toLowerCase();
}

function canonicalPostId(raw) {
  if (raw == null || raw === '') return '';
  if (typeof raw === 'number' && isFinite(raw)) return String(Math.trunc(raw));
  var s = String(raw).trim();
  if (!s) return '';
  if (/^\d+\.0+$/.test(s)) return String(parseInt(s, 10));
  if (/^\d+$/.test(s)) return s;
  var m = s.match(/^(?:post\s*#|id[=:]\s*)([A-Za-z0-9_-]+)/i);
  if (m) return canonicalPostId(m[1]);
  if (/^[A-Za-z0-9_-]{1,80}$/.test(s)) return s;
  return '';
}

async function cfFetch(path, opts, ms) {
  var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  var timer = null;
  if (ctrl) timer = setTimeout(function () { try { ctrl.abort(); } catch (e) {} }, ms || 12000);
  try {
    var r = await fetch(CF_API + path, Object.assign({
      cache: 'no-store',
      signal: ctrl ? ctrl.signal : undefined
    }, opts || {}));
    var j = await r.json().catch(function () { return {}; });
    return { ok: r.ok, status: r.status, json: j };
  } catch (e) {
    return {
      ok: false,
      status: 0,
      json: { error: 'cf_timeout', detail: String((e && e.message) || e).slice(0, 160) }
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function sbRest(path, opts) {
  if (!SB_URL || !SB_KEY) return { ok: false, status: 0, data: { error: 'missing_sb' } };
  var r = await fetch(SB_URL + path, Object.assign({
    headers: {
      apikey: SB_KEY,
      Authorization: 'Bearer ' + SB_KEY,
      'Content-Type': 'application/json',
      Prefer: 'return=representation'
    },
    cache: 'no-store'
  }, opts || {}));
  var text = await r.text();
  var data = null;
  try { data = text ? JSON.parse(text) : null; } catch (_) { data = text; }
  return { ok: r.ok, status: r.status, data: data };
}

function defaultMessage(body) {
  var kind = normKind(body.kind);
  var user = normUser(body.user || body.user_id);
  var postId = body.post_id || body.postId || '';
  var amount = body.amount || '';
  var label = body.label || kind;
  var fromPayload = body.payload && (body.payload.message || body.payload.msg);
  if (fromPayload) return String(fromPayload).slice(0, 500);
  if (body.message) return String(body.message).slice(0, 500);
  return (
    '🚨 ' + String(label).toUpperCase() +
    ' · @' + (user || 'user') +
    (amount ? (' · ' + amount) : '') +
    (postId ? (' · post #' + postId) : '')
  );
}

function requestKeyFor(kind, user, postId, provider) {
  // Dedupe window key: same user + post + provider pending claim.
  return [kind, String(user || '').toLowerCase(), String(postId || ''), String(provider || 'external').toLowerCase()]
    .join('|')
    .slice(0, 180);
}

async function createRequest(body) {
  var kind = normKind(body.kind);
  var user = normUser(body.user_id || body.user);
  var payload = {
    kind: kind,
    user_id: user,
    amount: body.amount == null ? '' : String(body.amount),
    coins: Number(body.coins || 0) || 0,
    post_id: body.post_id == null && body.postId == null ? '' : String(body.post_id || body.postId || ''),
    provider: body.provider == null ? '' : String(body.provider),
    label: body.label == null ? '' : String(body.label),
    payload: body.payload && typeof body.payload === 'object' ? body.payload : {}
  };
  var last = null;
  // CF /requests can abort under load — retry so PayPal/Throne claims are not lost.
  for (var attempt = 0; attempt < 3; attempt++) {
    last = await cfFetch('/requests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: SITE },
      body: JSON.stringify(payload)
    }, 14000);
    if (last.ok && last.json && last.json.ok !== false) return last;
    var err = String((last.json && (last.json.error || last.json.detail)) || '');
    if (!/timeout|abort|cf_timeout|fetch failed|network/i.test(err) && last.status !== 0) break;
  }
  return last;
}

async function persistDeletionPaymentRequest(meta) {
  meta = meta || {};
  var postId = canonicalPostId(meta.post_id || meta.postId);
  var user = normUser(meta.user_id || meta.user);
  if (!postId || !user) return { ok: false, error: 'missing_post_or_user' };
  var provider = String(meta.provider || 'paypal/throne').slice(0, 40);
  var key = requestKeyFor('remove_request', user, postId, provider);
  var row = {
    request_key: key,
    post_id: postId,
    requester: user,
    publisher: String(meta.publisher || (meta.payload && meta.payload.publisher) || '').slice(0, 80),
    provider: provider,
    amount: String(meta.amount || '$5').slice(0, 40),
    status: 'pending',
    message: String(meta.message || '').slice(0, 500),
    thumb_url: String((meta.payload && meta.payload.thumb_url) || meta.thumb_url || '').slice(0, 500),
    cf_request_id: String(meta.cf_request_id || '').slice(0, 120),
    payload: meta.payload && typeof meta.payload === 'object' ? meta.payload : {},
    updated_at: new Date().toISOString()
  };

  // Prefer upsert on request_key so duplicate I-paid clicks do not spam rows.
  var up = await sbRest('/rest/v1/deletion_payment_requests?on_conflict=request_key', {
    method: 'POST',
    headers: {
      apikey: SB_KEY,
      Authorization: 'Bearer ' + SB_KEY,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=representation'
    },
    body: JSON.stringify(row)
  });
  if (up.ok) {
    var rows = Array.isArray(up.data) ? up.data : [];
    return { ok: true, row: rows[0] || row, duplicate: false };
  }
  var detail = JSON.stringify(up.data || {});
  if (/PGRST205|does not exist|schema cache/i.test(detail)) {
    return { ok: false, skipped: true, error: 'table_missing' };
  }
  // Fallback: plain insert (unique violation ⇒ treat as duplicate success).
  var ins = await sbRest('/rest/v1/deletion_payment_requests', {
    method: 'POST',
    body: JSON.stringify(row)
  });
  if (ins.ok) {
    var rows2 = Array.isArray(ins.data) ? ins.data : [];
    return { ok: true, row: rows2[0] || row, duplicate: false };
  }
  var d2 = JSON.stringify(ins.data || {});
  if (/duplicate|unique|23505/i.test(d2)) {
    return { ok: true, duplicate: true, row: row };
  }
  if (/PGRST205|does not exist/i.test(d2)) {
    return { ok: false, skipped: true, error: 'table_missing' };
  }
  return { ok: false, error: d2.slice(0, 180), status: ins.status };
}

async function persistSbNotification(to, from, type, postId, message) {
  var row = {
    to_username: to,
    from_username: from,
    type: type,
    message: String(message || '').slice(0, 500),
    created_at: new Date().toISOString(),
    read: false
  };
  if (postId && /^\d+$/.test(String(postId))) row.post_id = Number(postId);
  else if (postId) row.post_id = String(postId);
  var res = await sbRest('/rest/v1/notifications', {
    method: 'POST',
    body: JSON.stringify(row)
  });
  return { to: to, ok: !!res.ok, status: res.status };
}

async function postNotif(to, from, type, postId, message) {
  var res = await cfFetch('/notifs', {
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
  }, 10000);
  return { to: to, ok: !!(res.ok && res.json && res.json.ok !== false), status: res.status, error: res.json && res.json.error };
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    return res.end();
  }
  if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'method_not_allowed' });

  try {
    var body = await readBody(req);
    var rawKind = normKind(body.kind || body.type || 'payment');
    var notifyOnly = !!(body.notify_only || body.notif_only || body.skip_request);
    // Never accept print via this generic intake (must use /api/print-submit).
    if (/print/i.test(rawKind) && !notifyOnly) {
      return json(res, 400, { ok: false, error: 'use_print_submit' });
    }
    var kind = ALLOWED_KINDS[rawKind] ? rawKind : (notifyOnly ? 'payment' : '');
    if (!kind) {
      return json(res, 400, { ok: false, error: 'invalid_kind', allowed: Object.keys(ALLOWED_KINDS) });
    }

    var user = normUser(body.user_id || body.user || body.from_username || body.from);
    // Bare guest/anon blocked. Stable anon_<session> is allowed for remove_request and
    // pin_payment_request ($5 delete/pin claims without registration).
    if (!user || user === 'guest' || user === 'anon') {
      return json(res, 401, { ok: false, error: 'login_required' });
    }
    var isAnonSession = /^anon[_:]/i.test(user) || /^anon_tmp/i.test(user);
    // Never credit Coins to anonymous session identities.
    if (kind === 'coins' && isAnonSession) {
      return json(res, 401, { ok: false, error: 'register_required_for_coins' });
    }

    var postId = canonicalPostId(body.post_id == null && body.postId == null ? '' : (body.post_id || body.postId || ''));
    // Delete payment claims MUST carry the real posts.id — blank tickets never reach admin usefully.
    if (kind === 'remove_request' && !notifyOnly && !postId) {
      return json(res, 400, {
        ok: false,
        error: 'missing_post_id',
        detail: 'PayPal/Throne/Bitcoin delete requests require the post id.'
      });
    }

    var message = defaultMessage(Object.assign({}, body, { kind: rawKind || kind, user: user, post_id: postId }));
    if (postId && message.indexOf('post #') < 0) {
      message = String(message).slice(0, 450) + ' · post #' + postId;
    }
    var notifType = rawKind || kind;

    var requestOk = false;
    var duplicate = false;
    var request = null;
    var requestError = null;
    if (!notifyOnly) {
      try {
        var creq = await createRequest(Object.assign({}, body, { kind: kind, user_id: user, post_id: postId }));
        if (creq.ok && creq.json && creq.json.ok !== false) {
          requestOk = true;
          duplicate = !!creq.json.duplicate;
          request = creq.json.request || creq.json;
        } else {
          requestError = (creq.json && (creq.json.error || creq.json.detail)) || ('cf_request_http_' + creq.status);
        }
      } catch (e) {
        requestError = String((e && e.message) || e).slice(0, 160);
      }
    }

    var sbPersist = null;
    if (kind === 'remove_request' && !notifyOnly && postId) {
      try {
        sbPersist = await persistDeletionPaymentRequest({
          user: user,
          post_id: postId,
          amount: body.amount || '$5',
          provider: body.provider || 'paypal/throne',
          message: message,
          publisher: (body.payload && body.payload.publisher) || body.publisher || '',
          payload: body.payload && typeof body.payload === 'object' ? body.payload : {},
          cf_request_id: request && request.id ? String(request.id) : ''
        });
        if (sbPersist && sbPersist.duplicate) duplicate = true;
      } catch (e) {
        sbPersist = { ok: false, error: String((e && e.message) || e).slice(0, 120) };
      }
    }

    var aliases = ['admin', 'MasterSan', 'mastersan', 'mastersan01'];
    var notifResults = [];
    for (var i = 0; i < aliases.length; i++) {
      try {
        notifResults.push(await postNotif(aliases[i], user, notifType, postId, message));
      } catch (e) {
        notifResults.push({ to: aliases[i], ok: false, error: String((e && e.message) || e).slice(0, 120) });
      }
    }
    // Supabase notifications backup (admin panel also reads these).
    if (kind === 'remove_request' && postId) {
      for (var si = 0; si < aliases.length; si++) {
        try {
          notifResults.push(await persistSbNotification(aliases[si], user, notifType, postId, message));
        } catch (e) {
          notifResults.push({ to: aliases[si], ok: false, error: String((e && e.message) || e).slice(0, 120) });
        }
      }
    }
    var notifOk = notifResults.some(function (x) { return x && x.ok; });
    var sbOk = !!(sbPersist && sbPersist.ok);

    // remove_request is durable if CF request OR SB deletion_payment_requests OR notifs landed.
    var ok = requestOk || sbOk || notifOk;
    // For delete claims, prefer reporting failure when NOTHING durable landed.
    if (kind === 'remove_request' && !notifyOnly && !requestOk && !sbOk && !notifOk) {
      return json(res, 502, {
        ok: false,
        error: requestError || 'all_channels_failed',
        request_error: requestError,
        sb_persist: sbPersist,
        notifs: notifResults
      });
    }

    return json(res, ok ? 200 : 502, {
      ok: ok,
      request: request,
      duplicate: duplicate,
      email: null,
      notifs: notifResults,
      channels: { request: requestOk, notifs: notifOk, supabase: sbOk },
      sb_persist: sbPersist,
      error: ok ? null : (requestError || 'all_channels_failed'),
      request_error: requestError,
      post_id: postId
    });
  } catch (e) {
    console.error('admin-request', e);
    return json(res, 500, { ok: false, error: 'admin_request_failed', message: String((e && e.message) || e).slice(0, 200) });
  }
};
