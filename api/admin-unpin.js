/**
 * Admin unpin — clears featured/pinned state without deleting the post.
 *
 * POST /api/admin-unpin
 * Headers: Authorization: Bearer <cf_admin_token>
 * Body: {
 *   postId?: string|number,
 *   username?: string,   // unpin every active pin for this author (e.g. LoserFagg)
 *   allForUser?: boolean
 * }
 *
 * - Requires a valid Cloudflare Worker admin token (same as panel unlock).
 * - Updates Supabase posts.featured_until / featured (service role when available).
 * - Retires __PIN_BOARD__ notifs for the post id(s).
 * - Never deletes the original post, media, comments, or stats.
 */
const CF_API = process.env.CF_API || 'https://ruiningsubs-api.0788adm.workers.dev';
const SITE = process.env.SITE_URL || 'https://www.ruinexpose.com';

let createClient = null;
try {
  createClient = require('@supabase/supabase-js').createClient;
} catch (_) {
  createClient = null;
}

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
  // Public anon fallback (same as SPA) — Prefer return=representation verifies rows.
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNubHBkb2x6aHpjYmJkeXhxbG5iIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY1NTg0OTYsImV4cCI6MjEwMjEzNDQ5Nn0.sWbn1sLgG6vi6wzKxpW5-1Td47awaxhwA-4ixKXZN-E';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store'
};

function json(res, status, body) {
  res.statusCode = status;
  Object.entries(cors).forEach(([k, v]) => res.setHeader(k, v));
  res.end(JSON.stringify(body));
}

function sbClient() {
  if (createClient) {
    return createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });
  }
  return null;
}

async function sbRest(path, opts) {
  const r = await fetch(SB_URL + path, Object.assign({
    headers: {
      apikey: SB_KEY,
      Authorization: 'Bearer ' + SB_KEY,
      'Content-Type': 'application/json',
      Prefer: 'return=representation'
    },
    cache: 'no-store'
  }, opts || {}));
  const text = await r.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch (_) {
    data = text;
  }
  return { ok: r.ok, status: r.status, data: data };
}

function bearerToken(req) {
  const h = String((req.headers && (req.headers.authorization || req.headers.Authorization)) || '');
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? String(m[1] || '').trim() : '';
}

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8') || '{}';
  try {
    return JSON.parse(raw);
  } catch (_) {
    return {};
  }
}

async function cfFetch(path, opts) {
  const r = await fetch(CF_API + path, Object.assign({ cache: 'no-store' }, opts || {}));
  let j = {};
  try {
    j = await r.json();
  } catch (_) {
    j = {};
  }
  return { ok: r.ok, status: r.status, json: j };
}

async function verifyAdminToken(token) {
  if (!token) return false;
  const res = await cfFetch('/admin/requests?limit=1', {
    headers: { Authorization: 'Bearer ' + token, Origin: SITE }
  });
  return !!(res.ok && res.json && res.json.ok !== false);
}

function normPostId(id) {
  if (id == null || id === '') return '';
  if (typeof id === 'number' && isFinite(id)) return String(Math.trunc(id));
  const s = String(id).trim();
  if (!s) return '';
  if (/^\d+\.0+$/.test(s)) return String(parseInt(s, 10));
  return s;
}

function normUser(u) {
  return String(u || '')
    .trim()
    .replace(/^@+/, '');
}

function parseBoardMsg(raw) {
  try {
    if (!raw) return null;
    if (typeof raw === 'object') return raw;
    return JSON.parse(String(raw));
  } catch (_) {
    return null;
  }
}

async function retirePinBoard(postId) {
  let removed = 0;
  try {
    const res = await cfFetch('/notifs?to=' + encodeURIComponent('__PIN_BOARD__'), {
      headers: { Origin: SITE }
    });
    const list = (res.json && res.json.notifs) || [];
    for (let i = 0; i < list.length; i++) {
      const n = list[i];
      if (!n || !n.id) continue;
      const msg = parseBoardMsg(n.message);
      const pid = String((msg && (msg.id || msg.post_id)) || n.post_id || '');
      if (pid !== String(postId) && String(n.post_id || '') !== String(postId)) continue;
      try {
        const dr = await cfFetch('/notifs/' + encodeURIComponent(String(n.id)), {
          method: 'DELETE',
          headers: { Origin: SITE }
        });
        if (dr && dr.ok) removed++;
      } catch (_) {}
    }
  } catch (_) {}
  try {
    await cfFetch('/posts/' + encodeURIComponent(String(postId)), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Origin: SITE },
      body: JSON.stringify({ featured_until: 0 })
    });
  } catch (_) {}
  return removed;
}

async function clearDbPin(client, postId) {
  const key = /^\d+$/.test(String(postId)) ? Number(postId) : postId;
  const patch = { featured_until: null, featured: false };
  if (client) {
    let q = await client.from('posts').update(patch).eq('id', key).select('id,username,featured,featured_until');
    if (q.error && /featured/i.test(String(q.error.message || ''))) {
      q = await client.from('posts').update({ featured_until: null }).eq('id', key).select('id,username,featured_until');
    }
    if (q.error) return { ok: false, error: q.error.message, rows: [] };
    const rows = q.data || [];
    return { ok: rows.length > 0, rows, error: rows.length ? null : 'no_row_updated' };
  }
  const rest = await sbRest('/rest/v1/posts?id=eq.' + encodeURIComponent(String(key)), {
    method: 'PATCH',
    body: JSON.stringify(patch)
  });
  if (!rest.ok) return { ok: false, error: 'rest_patch_failed', rows: [] };
  const rows = Array.isArray(rest.data) ? rest.data : [];
  return { ok: rows.length > 0, rows, error: rows.length ? null : 'no_row_updated' };
}

async function clearDbPinsForUser(client, username) {
  const name = normUser(username);
  if (!name) return { ok: false, error: 'missing_username', rows: [] };
  const patch = { featured_until: null, featured: false };
  if (client) {
    let q = await client
      .from('posts')
      .update(patch)
      .ilike('username', name)
      .select('id,username,featured,featured_until');
    if (q.error && /featured/i.test(String(q.error.message || ''))) {
      q = await client.from('posts').update({ featured_until: null }).ilike('username', name).select('id,username,featured_until');
    }
    if (q.error) return { ok: false, error: q.error.message, rows: [] };
    return { ok: true, rows: q.data || [] };
  }
  const rest = await sbRest('/rest/v1/posts?username=ilike.' + encodeURIComponent(name), {
    method: 'PATCH',
    body: JSON.stringify(patch)
  });
  if (!rest.ok) return { ok: false, error: 'rest_patch_failed', rows: [] };
  return { ok: true, rows: Array.isArray(rest.data) ? rest.data : [] };
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return json(res, 204, {});
  if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'method_not_allowed' });

  const token = bearerToken(req);
  let adminOk = false;
  try {
    adminOk = await verifyAdminToken(token);
  } catch (_) {
    adminOk = false;
  }
  if (!adminOk) return json(res, 401, { ok: false, error: 'admin_required' });

  let body;
  try {
    body = await readBody(req);
  } catch (_) {
    return json(res, 400, { ok: false, error: 'bad_json' });
  }

  const postId = normPostId(body.postId || body.id || body.post_id);
  const username = normUser(body.username || body.user || '');
  const allForUser = !!(body.allForUser || body.all_for_user || (username && !postId));

  let client = null;
  try {
    client = sbClient();
  } catch (_) {
    client = null;
  }

  const unpinned = [];
  const boardRemoved = {};

  if (allForUser && username) {
    const db = await clearDbPinsForUser(client, username);
    if (!db.ok && db.error) return json(res, 500, { ok: false, error: 'db_unpin_failed', detail: db.error });
    for (let i = 0; i < (db.rows || []).length; i++) {
      const row = db.rows[i];
      const id = normPostId(row && row.id);
      if (!id) continue;
      unpinned.push(id);
      try {
        boardRemoved[id] = await retirePinBoard(id);
      } catch (_) {
        boardRemoved[id] = 0;
      }
    }
    return json(res, 200, {
      ok: true,
      mode: 'user',
      username,
      unpinned,
      count: unpinned.length,
      boardRemoved,
      preserved: 'posts_media_comments_stats'
    });
  }

  if (!postId) return json(res, 400, { ok: false, error: 'missing_post_id' });

  const db = await clearDbPin(client, postId);
  if (!db.ok) {
    // Still retire board + CF so Spotlight clears even if the row was already unpinned.
    let removed = 0;
    try {
      removed = await retirePinBoard(postId);
    } catch (_) {}
    if (db.error === 'no_row_updated' && removed > 0) {
      return json(res, 200, {
        ok: true,
        mode: 'post',
        postId,
        unpinned: [postId],
        boardRemoved: { [postId]: removed },
        note: 'board_cleared_db_unchanged'
      });
    }
    return json(res, 404, { ok: false, error: db.error || 'not_found', postId });
  }

  let removed = 0;
  try {
    removed = await retirePinBoard(postId);
  } catch (_) {}

  return json(res, 200, {
    ok: true,
    mode: 'post',
    postId,
    unpinned: [postId],
    row: (db.rows && db.rows[0]) || null,
    boardRemoved: { [postId]: removed },
    preserved: 'posts_media_comments_stats'
  });
};
