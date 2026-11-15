/**
 * Admin users list + DB total count.
 *
 * GET /api/admin-users?q=&page=1&limit=50
 * Headers: Authorization: Bearer <cf_admin_token>
 *
 * Returns:
 *  - total: registered accounts (DB count, not page length)
 *  - filtered: matches for current search (DB count)
 *  - visible: users on this page
 *  - users: lean rows (no bios / private auth secrets)
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
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNubHBkb2x6aHpjYmJkeXhxbG5iIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY1NTg0OTYsImV4cCI6MjEwMjEzNDQ5Nn0.sWbn1sLgG6vi6wzKxpW5-1Td47awaxhwA-4ixKXZN-E';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store'
};

const SAFE_COLS =
  'username,avatar_url,status,banned,suspended,ip_banned,ip_address,xp,updated_at,telegram,twitter,link';

function json(res, status, body) {
  res.statusCode = status;
  Object.entries(cors).forEach(([k, v]) => res.setHeader(k, v));
  res.end(JSON.stringify(body));
}

function sbClient() {
  if (!createClient) return null;
  return createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });
}

async function sbRest(path, extraHeaders) {
  const r = await fetch(SB_URL + path, {
    headers: Object.assign(
      {
        apikey: SB_KEY,
        Authorization: 'Bearer ' + SB_KEY,
        Accept: 'application/json',
        Prefer: 'count=exact'
      },
      extraHeaders || {}
    ),
    cache: 'no-store'
  });
  const text = await r.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : [];
  } catch (_) {
    data = [];
  }
  const cr = r.headers.get('content-range') || '';
  const m = cr.match(/\/(\d+|\*)/);
  const count = m && m[1] !== '*' ? parseInt(m[1], 10) : null;
  return { ok: r.ok, status: r.status, data: data, count: count, error: r.ok ? null : text.slice(0, 200) };
}

function bearerToken(req) {
  const h = String((req.headers && (req.headers.authorization || req.headers.Authorization)) || '');
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? String(m[1] || '').trim() : '';
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

function parseQuery(req) {
  try {
    const host = (req.headers && (req.headers.host || 'localhost')) || 'localhost';
    const u = new URL(req.url || '/', 'http://' + host);
    return {
      q: String(u.searchParams.get('q') || u.searchParams.get('search') || '').trim(),
      page: Math.max(1, parseInt(u.searchParams.get('page') || '1', 10) || 1),
      limit: Math.min(100, Math.max(10, parseInt(u.searchParams.get('limit') || '50', 10) || 50))
    };
  } catch (_) {
    return { q: '', page: 1, limit: 50 };
  }
}

function publicUser(row) {
  row = row || {};
  return {
    username: row.username || '',
    avatar_url: row.avatar_url || null,
    status: row.status || (row.banned ? 'banned' : row.suspended ? 'suspended' : 'active'),
    banned: !!row.banned,
    suspended: !!row.suspended,
    ip_banned: !!row.ip_banned,
    ip_address: row.ip_address || row.ip || null,
    // profiles.email does not exist in production — keep field for UI compatibility.
    email: row.email || null,
    xp: Number(row.xp || 0) || 0,
    updated_at: row.updated_at || null,
    created_at: row.created_at || row.updated_at || null,
    telegram: row.telegram || null,
    twitter: row.twitter || null,
    link: row.link || null
  };
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return json(res, 204, {});
  if (req.method !== 'GET') return json(res, 405, { ok: false, error: 'method_not_allowed' });

  const token = bearerToken(req);
  let adminOk = false;
  try {
    adminOk = await verifyAdminToken(token);
  } catch (_) {
    adminOk = false;
  }
  if (!adminOk) return json(res, 401, { ok: false, error: 'admin_required' });

  const { q, page, limit } = parseQuery(req);
  const from = (page - 1) * limit;
  const to = from + limit - 1;

  let client = null;
  try {
    client = sbClient();
  } catch (_) {
    client = null;
  }

  // Total registered accounts — always from DB, never from the current page.
  let total = 0;
  let filtered = 0;
  let users = [];

  if (client) {
    const t = await client.from('profiles').select('username', { count: 'exact', head: true });
    if (t.error) return json(res, 500, { ok: false, error: 'count_failed', detail: t.error.message });
    total = Number(t.count || 0) || 0;
    filtered = total;
    let listQ = client.from('profiles').select(SAFE_COLS, { count: 'exact' }).order('username', { ascending: true });
    if (q) {
      const like = '%' + q.replace(/[%_,]/g, '') + '%';
      listQ = listQ.or('username.ilike.' + like + ',ip_address.ilike.' + like);
    }
    listQ = listQ.range(from, to);
    const list = await listQ;
    if (list.error) {
      if (/ip_address|column/i.test(String(list.error.message || ''))) {
        let q2 = client
          .from('profiles')
          .select('username,avatar_url,status,banned,suspended,xp,updated_at', { count: 'exact' })
          .order('username', { ascending: true });
        if (q) q2 = q2.ilike('username', '%' + q.replace(/[%_,]/g, '') + '%');
        q2 = q2.range(from, to);
        const list2 = await q2;
        if (list2.error) return json(res, 500, { ok: false, error: 'list_failed', detail: list2.error.message });
        filtered = Number(list2.count != null ? list2.count : (list2.data || []).length) || 0;
        users = (list2.data || []).map(publicUser);
      } else {
        return json(res, 500, { ok: false, error: 'list_failed', detail: list.error.message });
      }
    } else {
      filtered = Number(list.count != null ? list.count : (list.data || []).length) || 0;
      users = (list.data || []).map(publicUser);
    }
  } else {
    const totalRes = await sbRest('/rest/v1/profiles?select=username', {
      'Range-Unit': 'items',
      Range: '0-0'
    });
    if (!totalRes.ok) return json(res, 500, { ok: false, error: 'count_failed', detail: totalRes.error });
    total = Number(totalRes.count || 0) || 0;
    let path =
      '/rest/v1/profiles?select=' +
      encodeURIComponent(SAFE_COLS) +
      '&order=username.asc';
    if (q) {
      const like = '*' + q.replace(/[*,]/g, '') + '*';
      path += '&or=' + encodeURIComponent('(username.ilike.' + like + ',ip_address.ilike.' + like + ')');
    }
    const listRes = await sbRest(path, {
      'Range-Unit': 'items',
      Range: from + '-' + to
    });
    if (!listRes.ok) return json(res, 500, { ok: false, error: 'list_failed', detail: listRes.error });
    filtered = Number(listRes.count != null ? listRes.count : (q ? (listRes.data || []).length : total)) || 0;
    if (!q) filtered = total || filtered;
    users = (Array.isArray(listRes.data) ? listRes.data : []).map(publicUser);
  }

  return json(res, 200, {
    ok: true,
    total,
    filtered,
    visible: users.length,
    page,
    limit,
    pages: Math.max(1, Math.ceil(filtered / limit) || 1),
    users,
    search: q || ''
  });
};
