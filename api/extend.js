// Extend by the publisher's public amount (extend_amount / ext_N tag).
// Same user can extend the SAME post again after 6h (motivates return visits).
// Cooldown is best-effort via CF notifs board (__EXTEND_COOLDOWN__).
// A flaky board must NEVER block the actual extend write.
// CF UUID posts → Worker /posts/:id/extend.
// Numeric / Supabase-only posts → PATCH posts.expires_at (anon RLS).

const CF_API = process.env.CF_API || 'https://ruiningsubs-api.0788adm.workers.dev';
const SITE = process.env.SITE_URL || 'https://www.ruinexpose.com';
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://snlpdolzhzcbbdyxqlnb.supabase.co';
const SUPABASE_ANON =
  process.env.SUPABASE_ANON_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNubHBkb2x6aHpjYmJkeXhxbG5iIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY1NTg0OTYsImV4cCI6MjEwMjEzNDQ5Nn0.sWbn1sLgG6vi6wzKxpW5-1Td47awaxhwA-4ixKXZN-E';
const COOLDOWN_MS = Number(process.env.EXTEND_COOLDOWN_MS || 6 * 60 * 60 * 1000);
const BOARD = '__EXTEND_COOLDOWN__';
const ACTION = 'extend';
const EXTEND_MINUTES_DEFAULT = 360; // fallback when post has no public amount
const EXTEND_MINUTES_MIN = 15;
const EXTEND_MINUTES_MAX = 4320; // 3 days

var locks = new Map();
var recent = new Map();

function json(res, code, body) {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Vary', 'Origin');
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

function fmtCooldownClock(ms) {
  var sec = Math.max(0, Math.ceil(Number(ms) / 1000));
  var h = Math.floor(sec / 3600);
  var m = Math.floor((sec % 3600) / 60);
  var s = sec % 60;
  if (h > 0) {
    return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
  }
  return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
}

function looksNumericId(id) {
  return /^\d+$/.test(String(id || '').trim());
}

function clampExtendMinutes(n) {
  n = Number(n);
  if (!isFinite(n) || n <= 0) return EXTEND_MINUTES_DEFAULT;
  n = Math.round(n);
  if (n < EXTEND_MINUTES_MIN) n = EXTEND_MINUTES_MIN;
  if (n > EXTEND_MINUTES_MAX) n = EXTEND_MINUTES_MAX;
  return n;
}

function parseExtendMinsFromTags(tags, fallback) {
  var def = clampExtendMinutes(fallback == null ? EXTEND_MINUTES_DEFAULT : fallback);
  if (!tags) return def;
  if (typeof tags === 'string') {
    try {
      tags = JSON.parse(tags);
    } catch (e) {
      tags = String(tags).split(/[,\s]+/);
    }
  }
  if (!Array.isArray(tags)) return def;
  for (var i = 0; i < tags.length; i++) {
    var m = String(tags[i] || '').match(/^ext(?:end)?_?(\d+)$/i);
    if (m) return clampExtendMinutes(Number(m[1]));
  }
  return def;
}

async function lookupPostExtendMinutes(postId, clientMinutes) {
  var client = clampExtendMinutes(clientMinutes || EXTEND_MINUTES_DEFAULT);
  // Prefer the post's stored public amount so every Extender matches the publisher's choice.
  try {
    var sel = await sbFetch(
      '/rest/v1/posts?select=id,extend_amount,tags&id=eq.' + encodeURIComponent(postId) + '&limit=1',
      { method: 'GET', headers: { Prefer: 'return=representation' } },
      5000
    );
    var row = Array.isArray(sel.json) ? sel.json[0] : null;
    if (sel.ok && row) {
      var fromAmt = Number(row.extend_amount);
      if (isFinite(fromAmt) && fromAmt > 0) return clampExtendMinutes(fromAmt);
      return parseExtendMinsFromTags(row.tags, client);
    }
  } catch (e) {}
  if (!looksNumericId(postId)) {
    try {
      var cf = await cfFetch('/posts/' + encodeURIComponent(postId), { method: 'GET' }, 5000);
      var p = cf.json && (cf.json.post || cf.json);
      if (cf.ok && p) {
        var a = Number(p.extend_amount || p.extend_mins);
        if (isFinite(a) && a > 0) return clampExtendMinutes(a);
        return parseExtendMinsFromTags(p.tags, client);
      }
    } catch (e2) {}
  }
  return client;
}

async function cfFetch(path, opts, ms) {
  var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  var timer = null;
  if (ctrl) {
    timer = setTimeout(function () { try { ctrl.abort(); } catch (e) {} }, ms || 8000);
  }
  try {
    opts = opts || {};
    var headers = Object.assign({
      'Content-Type': 'application/json',
      Origin: SITE,
      Referer: SITE + '/'
    }, opts.headers || {});
    var init = Object.assign({}, opts, {
      cache: 'no-store',
      signal: ctrl ? ctrl.signal : undefined,
      headers: headers
    });
    var r = await fetch(CF_API + path, init);
    var text = await r.text().catch(function () { return ''; });
    var j = {};
    try { j = text ? JSON.parse(text) : {}; } catch (e) { j = { raw: String(text).slice(0, 160) }; }
    return { ok: r.ok, status: r.status, json: j, text: text };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function sbFetch(path, opts, ms) {
  var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  var timer = null;
  if (ctrl) {
    timer = setTimeout(function () { try { ctrl.abort(); } catch (e) {} }, ms || 8000);
  }
  try {
    opts = opts || {};
    var headers = Object.assign({
      apikey: SUPABASE_ANON,
      Authorization: 'Bearer ' + SUPABASE_ANON,
      'Content-Type': 'application/json',
      Prefer: 'return=representation'
    }, opts.headers || {});
    var init = Object.assign({}, opts, {
      cache: 'no-store',
      signal: ctrl ? ctrl.signal : undefined,
      headers: headers
    });
    var r = await fetch(SUPABASE_URL + path, init);
    var text = await r.text().catch(function () { return ''; });
    var j = null;
    try { j = text ? JSON.parse(text) : null; } catch (e) { j = { raw: String(text).slice(0, 160) }; }
    return { ok: r.ok, status: r.status, json: j, text: text };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function fetchCooldownNotifs() {
  try {
    var res = await cfFetch('/notifs?to=' + encodeURIComponent(BOARD), {}, 4000);
    if (!res.ok) {
      console.warn('cooldown_board_http_' + res.status);
      return [];
    }
    return (res.json && res.json.notifs) || [];
  } catch (e) {
    console.warn('cooldown_board_fetch', e && e.message);
    return [];
  }
}

function findCooldown(notifs, user, postId) {
  var key = cooldownKey(user, postId);
  var best = null;
  for (var i = 0; i < (notifs || []).length; i++) {
    var n = notifs[i];
    if (!n) continue;
    var msg = parseMsg(n.message);
    var from = normUser(n.from_username || (msg && msg.user) || '');
    var pid = normPost(n.post_id || (msg && msg.post_id) || '');
    var action = String((msg && msg.action_type) || ACTION);
    if (action !== ACTION) continue;
    if (from !== user || pid !== postId) continue;
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
    minutes: Number(minutes) || EXTEND_MINUTES_DEFAULT
  };
  recent.set(cooldownKey(user, postId), { at: at });
  try {
    var res = await cfFetch('/notifs', {
      method: 'POST',
      body: JSON.stringify({
        to_username: BOARD,
        from_username: user,
        type: 'extend_cd',
        post_id: postId,
        message: JSON.stringify(payload)
      })
    }, 4000);
    if (!res.ok) console.warn('cooldown_write_failed_' + res.status);
  } catch (e) {
    console.warn('cooldown_write', e && e.message);
  }
  return payload;
}

function parseExtenders(raw) {
  if (Array.isArray(raw)) return raw.slice();
  if (typeof raw === 'string') {
    try {
      var j = JSON.parse(raw);
      return Array.isArray(j) ? j.slice() : [];
    } catch (e) {
      return [];
    }
  }
  return [];
}

async function callSbExtend(postId, minutes, user) {
  var sel = await sbFetch(
    '/rest/v1/posts?select=id,expires_at,extensions_count,extenders&id=eq.' + encodeURIComponent(postId) + '&limit=1',
    { method: 'GET', headers: { Prefer: 'return=representation' } },
    6000
  );
  var row = Array.isArray(sel.json) ? sel.json[0] : (sel.json && sel.json.id ? sel.json : null);
  if (!sel.ok || !row) {
    var err = new Error('not found');
    err.status = 404;
    err.body = sel.json;
    throw err;
  }
  var baseMs = row.expires_at ? new Date(row.expires_at).getTime() : 0;
  if (!baseMs || isNaN(baseMs) || baseMs < Date.now()) baseMs = Date.now();
  var nextMs = baseMs + clampExtendMinutes(minutes) * 60000;
  var nextIso = new Date(nextMs).toISOString();
  var extensions = (Number(row.extensions_count) || 0) + 1;
  var extenders = parseExtenders(row.extenders);
  if (user && extenders.indexOf(user) < 0) extenders.push(user);
  var patch = await sbFetch(
    '/rest/v1/posts?id=eq.' + encodeURIComponent(postId),
    {
      method: 'PATCH',
      body: JSON.stringify({
        expires_at: nextIso,
        extensions_count: extensions,
        extenders: extenders
      })
    },
    8000
  );
  if (!patch.ok) {
    var err2 = new Error((patch.json && (patch.json.message || patch.json.error)) || ('sb_extend_http_' + patch.status));
    err2.status = patch.status || 500;
    err2.body = patch.json;
    throw err2;
  }
  var saved = Array.isArray(patch.json) ? patch.json[0] : patch.json;
  return {
    ok: true,
    source: 'supabase',
    expires_at: saved && saved.expires_at ? new Date(saved.expires_at).getTime() : nextMs,
    extensions: saved && saved.extensions_count != null ? Number(saved.extensions_count) : extensions,
    extenders: saved && saved.extenders != null ? parseExtenders(saved.extenders) : extenders
  };
}

async function callCfExtend(postId, minutes, user) {
  var res = await cfFetch('/posts/' + encodeURIComponent(postId) + '/extend', {
    method: 'POST',
    body: JSON.stringify({ minutes: clampExtendMinutes(minutes), user: user })
  }, 10000);
  if (!res.ok) {
    var err = new Error((res.json && (res.json.error || res.json.message)) || ('extend_http_' + res.status));
    err.status = res.status;
    err.body = res.json;
    throw err;
  }
  return Object.assign({ source: 'cloudflare' }, res.json || {});
}

async function callExtend(postId, minutes, user) {
  // UUID-ish CF posts: try Worker first. Numeric IDs are Supabase-only → skip CF 404.
  if (!looksNumericId(postId)) {
    try {
      return await callCfExtend(postId, minutes, user);
    } catch (e) {
      var msg = String((e && e.message) || '').toLowerCase();
      var st = Number(e && e.status) || 0;
      if (!(st === 404 || /not\s*found|missing|unknown/i.test(msg))) throw e;
      // Fall through to Supabase for cross-store ids.
    }
  }
  return await callSbExtend(postId, minutes, user);
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
    extend_minutes: EXTEND_MINUTES_DEFAULT,
    user: user,
    post_id: postId,
    action_type: ACTION,
    last_at: hit ? hit.at : null,
    site: SITE
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
    if (!user) return json(res, 401, { error: 'login_required' });
    if (!postId) return json(res, 400, { error: 'post_required' });
    // Publisher's public amount wins; client minutes are a hint/fallback.
    var minutes = await lookupPostExtendMinutes(
      postId,
      body.minutes || body.extend_amount || body.extend_mins || EXTEND_MINUTES_DEFAULT
    );

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
      // Soft cooldown check — board flaps must not block the write.
      var existing = null;
      try {
        var board = await fetchCooldownNotifs();
        existing = findCooldown(board, user, postId);
      } catch (eBoard) {
        console.warn('cooldown_check_skip', eBoard && eBoard.message);
      }
      if (existing && existing.remaining_ms > 0) {
        return json(res, 429, Object.assign({
          error: 'cooldown',
          message: 'You can extend again in ' + fmtCooldownClock(existing.remaining_ms)
        }, statusPayload(user, postId, existing)));
      }

      var ext = await callExtend(postId, minutes, user);
      var written = { at: Date.now() };
      try {
        written = await writeCooldown(user, postId, minutes);
      } catch (eWrite) {
        console.warn('cooldown_write_soft', eWrite && eWrite.message);
      }

      return json(res, 200, {
        ok: true,
        expires_at: ext.expires_at || null,
        extensions: ext.extensions != null ? ext.extensions : null,
        extenders: ext.extenders || null,
        minutes_added: minutes,
        cooldown_ms: COOLDOWN_MS,
        remaining_ms: COOLDOWN_MS,
        remaining_sec: Math.ceil(COOLDOWN_MS / 1000),
        available: false,
        last_at: written.at,
        user: user,
        post_id: postId,
        action_type: ACTION,
        source: ext.source || null,
        site: SITE
      });
    } finally {
      locks.delete(lockKey);
    }
  } catch (e) {
    console.error('extend api', e);
    var msg = String((e && e.message) || e).slice(0, 200);
    // Never surface raw "not found" alone — tell the client what failed.
    if (/not\s*found/i.test(msg)) {
      msg = 'Post not found on Cloudflare or Supabase';
    }
    return json(res, e.status || 500, {
      error: 'extend_failed',
      message: msg,
      detail: e.body || null
    });
  }
};
