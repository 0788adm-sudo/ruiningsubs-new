// Same-origin intake for Admin payment/remove/pin requests.
// Mobile Safari often fails direct browser → workers.dev ("Load failed").
// This proxy creates the CF /requests row AND fans out admin notifs so the
// inbox still gets the alert even if one channel flakes.

const CF_API = process.env.CF_API || 'https://ruiningsubs-api.0788adm.workers.dev';
const SITE = process.env.SITE_URL || 'https://www.ruinexpose.com';

const ALLOWED_KINDS = {
  remove_request: 1,
  pin_payment_request: 1,
  coins: 1,
  page_request: 1,
  payment: 1,
  feature_request: 1
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
  } finally {
    if (timer) clearTimeout(timer);
  }
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
  var res = await cfFetch('/requests', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: SITE },
    body: JSON.stringify(payload)
  }, 14000);
  return res;
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
    if (!user || user === 'guest' || user === 'anon') {
      return json(res, 401, { ok: false, error: 'login_required' });
    }

    var postId = body.post_id == null && body.postId == null ? '' : String(body.post_id || body.postId || '');
    var message = defaultMessage(Object.assign({}, body, { kind: rawKind || kind, user: user, post_id: postId }));
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
          requestError = (creq.json && creq.json.error) || ('cf_request_http_' + creq.status);
        }
      } catch (e) {
        requestError = String((e && e.message) || e).slice(0, 160);
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
    var notifOk = notifResults.some(function (x) { return x && x.ok; });

    var ok = requestOk || notifOk;
    return json(res, ok ? 200 : 502, {
      ok: ok,
      request: request,
      duplicate: duplicate,
      email: null,
      notifs: notifResults,
      channels: { request: requestOk, notifs: notifOk },
      error: ok ? null : (requestError || 'all_channels_failed'),
      request_error: requestError
    });
  } catch (e) {
    console.error('admin-request', e);
    return json(res, 500, { ok: false, error: 'admin_request_failed', message: String((e && e.message) || e).slice(0, 200) });
  }
};
