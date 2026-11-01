// Hourly Extend cooldown — server-side enforcement.
// Cooldown key: user_id + post_id + action_type ("extend")
// Persistence: Cloudflare Worker notifs board (__EXTEND_COOLDOWN__) so it
// survives refreshes and devices. Client timestamps are never trusted.

const CF_API = process.env.CF_API || 'https://ruiningsubs-api.0788adm.workers.dev';
const COOLDOWN_MS = Number(process.env.EXTEND_COOLDOWN_MS || 60 * 60 * 1000);
const BOARD = '__EXTEND_COOLDOWN__';
const ACTION = 'extend';

// Best-effort in-process lock (helps same-instance double-clicks on serverless).
var locks = new Map();
var recent = new Map();

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
  return String(u || '').replace(/^@/, '').trim().toLowerCase().slice(0, 40);
}

function normPost(id) {
  return String(id || '').trim().slice(0, 80);
}

function cooldownKey(user, postId) {
  return ACTION + '|' + user + '|' + postId;
}

function parseMsg(raw) {
  try {
    if (!raw) return null;
    if (typeof raw === 'object') return raw;
    return JSON.parse(String(raw));
  } catch (e) {
    return null;
  }
}

async function fetchCooldownNotifs() {
  var r = await fetch(CF_API + '/notifs?to=' + encodeURIComponent(BOARD), { cache: 'no-store' });
  if (!r.ok) throw new Error('cooldown_board_http_' + r.status);
  var j = await r.json().catch(function () { return {}; });
  return (j && j.notifs) || [];
}

function findCooldown(notifs, user, postId) {
  var key = cooldownKey(user, postId);
  var best = null;
  for (var i = 0; i < notifs.length; i++) {
    var n = notifs[i];
    if (!n) continue;
    var msg = parseMsg(n.message);
    var from = normUser(n.from_username || (msg && msg.user) || '');
    var pid = normPost(n.post_id || (msg && msg.post_id) || '');
    var action = String((msg && msg.action_type) || ACTION);
    if (action !== ACTION) continue;
    if (from !== user || pid !== postId) continue;
    // Prefer message.at; fall back to created_at from server
    var at = Number((msg && msg.at) || n.created_at || 0) || 0;
    if (!best || at > best.at) {
      best = {
        at: at,
        key: key,
        notif_id: n.id,
        remaining_ms: Math.max(0, COOLDOWN_MS - (Date.now() - at))
      };
    }
  }
  // Also check in-memory recent map (same instance)
  var mem = recent.get(key);
  if (mem && (!best || mem.at > best.at)) {
    best = {
      at: mem.at,
      key: key,
      notif_id: null,
      remaining_ms: Math.max(0, COOLDOWN_MS - (Date.now() - mem.at))
    };
  }
  return best;
}

async function writeCooldown(user, postId, minutes) {
  var at = Date.now();
  var payload = {
    user: user,
    post_id: postId,
    action_type: ACTION,
    at: at,
    minutes: Number(minutes) || 0
  };
  recent.set(cooldownKey(user, postId), { at: at });
  var r = await fetch(CF_API + '/notifs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      to_username: BOARD,
      from_username: user,
      type: 'extend_cd',
      post_id: postId,
      message: JSON.stringify(payload)
    }),
    cache: 'no-store'
  });
  if (!r.ok) {
    var t = await r.text().catch(function () { return ''; });
    throw new Error('cooldown_write_failed_' + r.status + ' ' + String(t).slice(0, 120));
  }
  return payload;
}

async function callCfExtend(postId, minutes, user) {
  var r = await fetch(CF_API + '/posts/' + encodeURIComponent(postId) + '/extend', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ minutes: Number(minutes) || 360, user: user }),
    cache: 'no-store'
  });
  var j = await r.json().catch(function () { return {}; });
  if (!r.ok) {
    var err = new Error((j && (j.error || j.message)) || ('extend_http_' + r.status));
    err.status = r.status;
    err.body = j;
    throw err;
  }
  return j;
}

function statusPayload(user, postId, hit) {
  var remaining = hit ? Number(hit.remaining_ms || 0) : 0;
  var available = !(hit && remaining > 0);
  return {
    ok: true,
    available: available,
    remaining_ms: available ? 0 : remaining,
    remaining_sec: available ? 0 : Math.ceil(remaining / 1000),
    cooldown_ms: COOLDOWN_MS,
    user: user,
    post_id: postId,
    action_type: ACTION,
    last_at: hit ? hit.at : null
  };
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    return res.end();
  }

  try {
    if (req.method === 'GET') {
      var qUser = normUser(req.query && (req.query.user || req.query.username));
      var qPost = normPost(req.query && (req.query.post_id || req.query.post || req.query.id));
      if (!qUser || !qPost) return json(res, 400, { error: 'user_and_post_required' });
      var notifs = await fetchCooldownNotifs();
      var hit = findCooldown(notifs, qUser, qPost);
      return json(res, 200, statusPayload(qUser, qPost, hit));
    }

    if (req.method !== 'POST') return json(res, 405, { error: 'method_not_allowed' });

    var body = await readBody(req);
    var user = normUser(body.user || body.username || body.from_username);
    var postId = normPost(body.post_id || body.post || body.id);
    var minutes = Number(body.minutes || body.extend_amount || 360) || 360;
    if (!user || user === 'guest' || user === 'anon') {
      // Allow named anon handles used by the SPA (Anon_####), reject empty.
      if (!user) return json(res, 401, { error: 'login_required' });
    }
    if (!postId) return json(res, 400, { error: 'post_required' });

    var lockKey = cooldownKey(user, postId);
    if (locks.get(lockKey)) {
      return json(res, 429, {
        error: 'in_flight',
        message: 'Extend already in progress',
        remaining_ms: COOLDOWN_MS,
        remaining_sec: Math.ceil(COOLDOWN_MS / 1000)
      });
    }
    locks.set(lockKey, Date.now());

    try {
      var board = await fetchCooldownNotifs();
      var existing = findCooldown(board, user, postId);
      if (existing && existing.remaining_ms > 0) {
        return json(res, 429, Object.assign({
          error: 'cooldown',
          message: 'Available again in ' + Math.ceil(existing.remaining_ms / 60000) + 'm'
        }, statusPayload(user, postId, existing)));
      }

      var ext = await callCfExtend(postId, minutes, user);
      var written = await writeCooldown(user, postId, minutes);

      return json(res, 200, {
        ok: true,
        expires_at: ext.expires_at || null,
        extensions: ext.extensions != null ? ext.extensions : null,
        extenders: ext.extenders || null,
        cooldown_ms: COOLDOWN_MS,
        remaining_ms: COOLDOWN_MS,
        remaining_sec: Math.ceil(COOLDOWN_MS / 1000),
        available: false,
        last_at: written.at,
        user: user,
        post_id: postId,
        action_type: ACTION
      });
    } finally {
      locks.delete(lockKey);
    }
  } catch (e) {
    console.error('extend api', e);
    return json(res, e.status || 500, {
      error: 'extend_failed',
      message: String((e && e.message) || e).slice(0, 200),
      detail: e.body || null
    });
  }
};
