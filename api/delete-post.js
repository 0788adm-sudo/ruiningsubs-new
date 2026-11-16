/**
 * Secure post deletion with Deletion Tier + FC spend.
 *
 * POST /api/delete-post
 * Body: {
 *   user: string,
 *   postId: string,
 *   reason?: 'owner'|'paid'|'moderation'|'privacy',
 *   adminKey?: string,
 *   ownerToken?: string,
 *   idempotencyKey?: string
 * }
 *
 * - deletable / free_deletion_enabled: verified owner deletes free (even with timer)
 * - locked / permanent: owner pays 50 FC (server-side price only)
 * - legacy timed (no explicit free flag): owner pays 50 FC
 * - non-owner / reason=paid: ALWAYS 50 FC then immediate delete (no admin request)
 * - moderation / privacy: free for admins — Permanent never blocks these
 * - spend is idempotent via CF wallet ledger; if DB delete fails after a NEW charge, refund
 * - FC auto-delete never creates admin notifications or pending requests
 */
const crypto = require('crypto');
const CF_API = process.env.CF_API || 'https://ruiningsubs-api.0788adm.workers.dev';
const SITE = process.env.SITE_URL || 'https://www.ruinexpose.com';
const SB_URL =
  process.env.SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.VITE_SUPABASE_URL ||
  'https://snlpdolzhzcbbdyxqlnb.supabase.co';
// Prefer service role (can DELETE). Fall back to the same anon key used by /api/extend
// so the function still boots when the npm package or env wiring is incomplete.
const SB_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNubHBkb2x6aHpjYmJkeXhxbG5iIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY1NTg0OTYsImV4cCI6MjEwMjEzNDQ5Nn0.sWbn1sLgG6vi6wzKxpW5-1Td47awaxhwA-4ixKXZN-E';
const DELETE_COST_FC = Number(process.env.FC_COST_DELETE || 50) || 50;
const ALLOWED_TIERS = new Set(['deletable', 'locked', 'permanent']);
const FREE_REASONS = new Set(['moderation', 'privacy']);

let createClient = null;
try {
  createClient = require('@supabase/supabase-js').createClient;
} catch (_) {
  createClient = null;
}

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
  if (!createClient || !SB_URL || !SB_KEY) return null;
  return createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });
}

async function sbRest(path, opts) {
  if (!SB_URL || !SB_KEY) throw new Error('Missing Supabase env');
  const r = await fetch(
    SB_URL + path,
    Object.assign(
      {
        headers: {
          apikey: SB_KEY,
          Authorization: 'Bearer ' + SB_KEY,
          'Content-Type': 'application/json',
          Prefer: 'return=representation'
        },
        cache: 'no-store'
      },
      opts || {}
    )
  );
  const text = await r.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch (_) {
    data = text;
  }
  return { ok: r.ok, status: r.status, data: data };
}

/** Case-insensitive identity for ownership / admin checks. */
function normUser(u) {
  return String(u || '')
    .trim()
    .replace(/^@+/, '')
    .toLowerCase();
}

/**
 * Wallet identity must match the header /admin credit key.
 * CF wallets are case-sensitive; lowercasing here caused "Insufficient FC"
 * while the header still showed the real balance under the original casing.
 * Same shape as /api/fc-spend + client coinUserId().
 */
function walletUser(u) {
  return String(u || '')
    .trim()
    .replace(/^@+/, '')
    .slice(0, 40);
}

function walletUserCandidates(raw) {
  const primary = walletUser(raw);
  const lower = primary.toLowerCase();
  const out = [];
  function push(v) {
    v = walletUser(v);
    if (!v) return;
    if (out.indexOf(v) < 0) out.push(v);
  }
  push(primary);
  push(lower);
  return out;
}

function parseTags(raw) {
  if (Array.isArray(raw)) return raw.map((t) => String(t || '').trim()).filter(Boolean);
  if (typeof raw === 'string') {
    try {
      const j = JSON.parse(raw);
      if (Array.isArray(j)) return j.map((t) => String(t || '').trim()).filter(Boolean);
    } catch (_) {}
    return raw
      .split(/[,\s]+/)
      .map((t) => t.trim())
      .filter(Boolean);
  }
  return [];
}

function tierFromTags(tags) {
  const hit = (tags || []).map((t) => String(t).toLowerCase()).find((t) => t.startsWith('del:'));
  if (!hit) return null;
  const v = hit.slice(4);
  return ALLOWED_TIERS.has(v) ? v : null;
}

function resolveTier(row) {
  const col = String(row?.deletion_tier || '')
    .trim()
    .toLowerCase();
  if (ALLOWED_TIERS.has(col)) return col;
  const fromTag = tierFromTags(parseTags(row?.tags));
  if (fromTag) return fromTag;
  return 'legacy';
}

function freeDeletionEnabled(row) {
  if (row && (row.free_deletion_enabled === true || row.free_deletion_enabled === 'true' || row.free_deletion_enabled === 1)) {
    return true;
  }
  if (resolveTier(row) === 'deletable') return true;
  const tags = parseTags(row?.tags).map((t) => String(t).toLowerCase());
  if (tags.some((t) => t === 'remove:free' || t === 'delete:free' || t === 'free-remove')) return true;
  return false;
}

function hashOwnerToken(token) {
  return crypto.createHash('sha256').update(String(token || ''), 'utf8').digest('hex');
}

/** Legacy timed-remove detection (only when free deletion was NOT explicitly chosen). */
function legacyRequiresFc(row) {
  if (freeDeletionEnabled(row)) return false;
  const tags = parseTags(row?.tags).map((t) => t.toLowerCase());
  if (tags.some((t) => t === 'profile_gallery' || t === 'profile_only' || t === 'normal_feed' || t === 'generated_id')) {
    return false;
  }
  if (Number(row?.extend_amount || 0) > 0 && row?.expires_at) return true;
  if (row?.expires_at) return true;
  if (tags.some((t) => /^(timed|expires?|countdown|t\d+|exp\d+)$/.test(t))) return true;
  return false;
}

function ownerDeleteCost(row) {
  const tier = resolveTier(row);
  if (tier === 'locked' || tier === 'permanent') return DELETE_COST_FC;
  // Explicit free deletion (compose choice) always free for the verified author.
  if (freeDeletionEnabled(row) || tier === 'deletable') return 0;
  // Legacy posts without an explicit free flag still pay when timed/Extend rules match.
  if (legacyRequiresFc(row)) return DELETE_COST_FC;
  return 0;
}

function isAdminUser(username) {
  const list = String(process.env.ADMIN_USERNAMES || process.env.ADMIN_USERS || 'admin,ruinexpose')
    .split(/[,;\s]+/)
    .map(normUser)
    .filter(Boolean);
  return list.includes(normUser(username));
}

function adminKeyOk(provided) {
  const expected = String(process.env.ADMIN_KEY || process.env.RUIN_ADMIN_KEY || '').trim();
  if (!expected) return false;
  return String(provided || '').trim() === expected;
}

function bearerToken(req) {
  const h = String((req.headers && (req.headers.authorization || req.headers.Authorization)) || '');
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? String(m[1] || '').trim() : '';
}

/** Verify Cloudflare Worker admin session — never trust client isAdmin flags alone. */
async function verifyCfAdminToken(token) {
  if (!token) return false;
  try {
    const res = await cfFetch('/admin/requests?limit=1', {
      headers: { Authorization: 'Bearer ' + token, Origin: SITE }
    });
    return !!(res.ok && res.json && res.json.ok !== false);
  } catch (_) {
    return false;
  }
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

/** CF wallet/ledger currently takes ~10s per call — always bound it so delete stays mobile-safe. */
async function cfFetch(path, opts, timeoutMs) {
  const ms = timeoutMs == null ? 2800 : Number(timeoutMs) || 2800;
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  let timer = null;
  if (ctrl) timer = setTimeout(function () { try { ctrl.abort(); } catch (_) {} }, ms);
  try {
    const init = Object.assign({ cache: 'no-store' }, opts || {});
    if (ctrl) init.signal = ctrl.signal;
    const r = await fetch(CF_API + path, init);
    let j = {};
    try {
      j = await r.json();
    } catch (_) {
      j = {};
    }
    return { ok: r.ok, status: r.status, json: j };
  } catch (e) {
    return {
      ok: false,
      status: 0,
      json: { error: 'cf_timeout', detail: String(e && e.message ? e.message : e) }
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function findLedgerRow(user, kind, action, ref, minCoins) {
  const res = await cfFetch('/wallet/ledger?user=' + encodeURIComponent(user));
  const rows = (res.json && res.json.ledger) || [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] || {};
    if (kind && String(row.kind || '') !== String(kind)) continue;
    if (action && String(row.action || '') !== String(action)) continue;
    if (String(row.ref_id || row.ref || '') !== String(ref || '')) continue;
    if (minCoins != null && Number(row.coins || 0) < Number(minCoins || 0)) continue;
    return row;
  }
  return null;
}

async function findLedgerSpend(user, action, ref, minCoins) {
  return findLedgerRow(user, 'spend', action, ref, minCoins);
}

function deleteSpendRef(user, postId, idemRef) {
  return String(idemRef || `delete-post:${postId}:${user}`).slice(0, 120);
}

function deleteRefundRef(user, postId) {
  return String(`delete-refund:${postId}:${user}`).slice(0, 120);
}

async function cfWalletBalance(user) {
  const res = await cfFetch('/wallet?user=' + encodeURIComponent(user));
  if (!(res.json && res.json.ok !== false) && !res.ok) return 0;
  return Number((res.json && res.json.balance) || 0) || 0;
}

async function sbWalletBalance(user) {
  const client = sbClient();
  if (client) {
    const q = await client.from('coin_wallets').select('balance').eq('user_id', user).maybeSingle();
    if (q.error) return 0;
    return Number((q.data && q.data.balance) || 0) || 0;
  }
  const rest = await sbRest(
    '/rest/v1/coin_wallets?select=balance&user_id=eq.' + encodeURIComponent(user) + '&limit=1'
  );
  if (!rest.ok) return 0;
  const rows = Array.isArray(rest.data) ? rest.data : [];
  return Number((rows[0] && rows[0].balance) || 0) || 0;
}

/**
 * Same numeric FC the header should show: pick the highest available wallet
 * across CF case variants and Supabase coin_wallets (never hide SB coins
 * behind a near-empty CF key). Parallel lookups keep delete-post under mobile timeouts.
 */
async function resolveFcBalance(rawUser) {
  const candidates = walletUserCandidates(rawUser);
  let best = { user: candidates[0] || walletUser(rawUser), balance: 0, source: 'cf' };
  const jobs = [];
  for (let i = 0; i < candidates.length; i++) {
    const u = candidates[i];
    jobs.push(
      cfWalletBalance(u)
        .then((bal) => ({ user: u, balance: Number(bal) || 0, source: 'cf' }))
        .catch(() => ({ user: u, balance: 0, source: 'cf' }))
    );
    jobs.push(
      sbWalletBalance(u)
        .then((bal) => ({ user: u, balance: Number(bal) || 0, source: 'supabase' }))
        .catch(() => ({ user: u, balance: 0, source: 'supabase' }))
    );
  }
  const results = await Promise.all(jobs);
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.balance > best.balance) best = r;
  }
  return best;
}

async function spendSupabaseFc(user, cost, ref) {
  const client = sbClient();
  let bal = 0;
  if (client) {
    const q = await client.from('coin_wallets').select('balance').eq('user_id', user).maybeSingle();
    if (q.error) return { ok: false, error: 'sb_load_failed', detail: q.error.message };
    bal = Number((q.data && q.data.balance) || 0) || 0;
    if (bal < cost) return { ok: false, error: 'insufficient', balance: bal, need: cost };
    const next = bal - cost;
    const upd = await client
      .from('coin_wallets')
      .update({ balance: next })
      .eq('user_id', user)
      .gte('balance', cost)
      .select('balance')
      .maybeSingle();
    if (upd.error) return { ok: false, error: 'sb_spend_failed', detail: upd.error.message, balance: bal };
    if (!upd.data) return { ok: false, error: 'insufficient', balance: bal, need: cost };
    try {
      await client.from('coin_ledger').insert({
        user_id: user,
        kind: 'spend',
        action: 'delete',
        coins: cost,
        ref: ref || null
      });
    } catch (_) {}
    return { ok: true, reused: false, balance: Number(upd.data.balance) || next, source: 'supabase', user };
  }

  bal = await sbWalletBalance(user);
  if (bal < cost) return { ok: false, error: 'insufficient', balance: bal, need: cost };
  const next = bal - cost;
  const rest = await sbRest('/rest/v1/coin_wallets?user_id=eq.' + encodeURIComponent(user) + '&balance=gte.' + cost, {
    method: 'PATCH',
    headers: {
      apikey: SB_KEY,
      Authorization: 'Bearer ' + SB_KEY,
      'Content-Type': 'application/json',
      Prefer: 'return=representation'
    },
    body: JSON.stringify({ balance: next })
  });
  if (!rest.ok) {
    return { ok: false, error: 'sb_spend_failed', status: rest.status, balance: bal };
  }
  const rows = Array.isArray(rest.data) ? rest.data : [];
  if (!rows.length) return { ok: false, error: 'insufficient', balance: bal, need: cost };
  return {
    ok: true,
    reused: false,
    balance: Number(rows[0].balance) || next,
    source: 'supabase',
    user
  };
}

/**
 * Charge 50 FC from the SAME wallet the header uses.
 * Prefer Supabase coin_wallets first — CF /wallet currently takes ~10s/call and
 * was making delete-post exceed mobile timeouts even after pin-scan removal.
 */
async function spendDeleteFc(rawUser, postId, idemRef) {
  const action = 'delete';
  const cost = DELETE_COST_FC;
  const candidates = walletUserCandidates(rawUser);
  const primary = candidates[0] || walletUser(rawUser);
  const ref = deleteSpendRef(primary, postId, idemRef);

  // --- Fast path: Supabase (typically <500ms) ---
  let bestSb = { user: primary, balance: 0 };
  const sbBalances = await Promise.all(
    candidates.map(async (u) => {
      try {
        return { user: u, balance: await sbWalletBalance(u) };
      } catch (_) {
        return { user: u, balance: 0 };
      }
    })
  );
  for (let i = 0; i < sbBalances.length; i++) {
    if (sbBalances[i].balance > bestSb.balance) bestSb = sbBalances[i];
  }
  if (bestSb.balance >= cost) {
    const spendRef = deleteSpendRef(bestSb.user, postId, idemRef);
    const sb = await spendSupabaseFc(bestSb.user, cost, spendRef);
    if (sb.ok) return Object.assign({ coins: cost, ref: spendRef }, sb);
    if (sb.error && sb.error !== 'insufficient') {
      return Object.assign({ need: cost, ref: spendRef }, sb);
    }
  }

  // --- CF path (bounded by cfFetch timeouts) ---
  // One ledger probe only (not per-candidate sequential 10s hits).
  try {
    const existing = await findLedgerSpend(primary, action, deleteSpendRef(primary, postId, idemRef), cost);
    if (existing) {
      return {
        ok: true,
        reused: true,
        balance: null,
        coins: cost,
        ref: deleteSpendRef(primary, postId, idemRef),
        user: primary,
        source: 'ledger'
      };
    }
  } catch (_) {}

  let bestCf = { user: primary, balance: 0 };
  const cfBalances = await Promise.all(
    candidates.map(async (u) => {
      try {
        return { user: u, balance: await cfWalletBalance(u) };
      } catch (_) {
        return { user: u, balance: 0 };
      }
    })
  );
  for (let i = 0; i < cfBalances.length; i++) {
    if (cfBalances[i].balance > bestCf.balance) bestCf = cfBalances[i];
  }

  if (bestCf.balance >= cost) {
    const spendRef = deleteSpendRef(bestCf.user, postId, idemRef);
    const res = await cfFetch(
      '/wallet',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: SITE },
        body: JSON.stringify({ user: bestCf.user, spend: cost, action, ref: spendRef })
      },
      4000
    );
    if (res.json && res.json.ok) {
      return {
        ok: true,
        reused: false,
        balance: res.json.balance != null ? Number(res.json.balance) : null,
        coins: cost,
        ref: spendRef,
        user: bestCf.user,
        source: 'cf'
      };
    }
  }

  const have = Math.max(bestSb.balance, bestCf.balance);
  return {
    ok: false,
    error: 'insufficient',
    need: cost,
    balance: have,
    have: have,
    ref,
    user: have === bestCf.balance ? bestCf.user : bestSb.user,
    source: bestCf.balance >= bestSb.balance ? 'cf' : 'supabase'
  };
}

/** Refund 50 FC if DB delete fails after a NEW charge — idempotent. */
async function refundDeleteFc(user, postId) {
  const ref = deleteRefundRef(user, postId);
  const existing =
    (await findLedgerRow(user, null, 'delete_refund', ref, DELETE_COST_FC)) ||
    (await findLedgerRow(user, 'add', null, ref, DELETE_COST_FC));
  if (existing) {
    return { ok: true, reused: true, balance: null, coins: DELETE_COST_FC, ref };
  }

  const res = await cfFetch('/wallet', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: SITE },
    body: JSON.stringify({
      user,
      add: DELETE_COST_FC,
      action: 'delete_refund',
      ref,
      admin: true
    })
  });

  if (res.json && res.json.ok) {
    return {
      ok: true,
      reused: false,
      balance: res.json.balance != null ? Number(res.json.balance) : null,
      coins: DELETE_COST_FC,
      ref
    };
  }
  return {
    ok: false,
    error: (res.json && (res.json.error || res.json.message)) || 'refund_failed',
    status: res.status,
    ref
  };
}

async function loadPostRow(postId) {
  // Live DB may lack deletion_tier / free_deletion_enabled / owner_token_hash —
  // select only columns that exist so we don't burn a failed round-trip.
  const colsBase = 'id,username,tags,expires_at,extend_amount';
  const client = sbClient();
  if (client) {
    const q = await client.from('posts').select(colsBase).eq('id', postId).maybeSingle();
    if (q.error) throw new Error(q.error.message || 'load_failed');
    return q.data || null;
  }
  const rest = await sbRest(
    '/rest/v1/posts?select=' + encodeURIComponent(colsBase) + '&id=eq.' + encodeURIComponent(postId) + '&limit=1'
  );
  if (!rest.ok) throw new Error('load_failed_http_' + rest.status);
  const rows = Array.isArray(rest.data) ? rest.data : [];
  return rows[0] || null;
}

async function deletePostRow(postId) {
  const client = sbClient();
  if (client) {
    const { data, error } = await client.from('posts').delete().eq('id', postId).select('id');
    if (error) return error;
    // RLS can return success with 0 rows — treat that as failure so we refund.
    if (!data || !data.length) {
      const still = await loadPostRow(postId);
      if (still) return { message: 'delete_blocked_or_noop', code: 'DELETE_NOOP' };
    }
  } else {
    const rest = await sbRest('/rest/v1/posts?id=eq.' + encodeURIComponent(String(postId)), {
      method: 'DELETE'
    });
    if (!rest.ok) {
      return { message: 'delete_failed_http_' + rest.status, details: rest.data };
    }
    const still = await loadPostRow(postId).catch(() => null);
    if (still) return { message: 'delete_blocked_or_noop', code: 'DELETE_NOOP' };
  }
  // Also drop CF mirror so feed/search cannot resurrect the post.
  try {
    await cfFetch('/posts/' + encodeURIComponent(String(postId)), {
      method: 'DELETE',
      headers: { Origin: SITE }
    });
  } catch (_) {}
  return null;
}

/** Best-effort Cloudflare purge for deleted post URLs + sitemap. Never fails the delete. */
async function purgeDeletedPostCaches(postId) {
  const zone = String(process.env.CF_ZONE_ID || process.env.CLOUDFLARE_ZONE_ID || '').trim();
  const token = String(process.env.CF_API_TOKEN || process.env.CLOUDFLARE_API_TOKEN || '').trim();
  const files = [
    SITE + '/post/' + encodeURIComponent(String(postId)),
    SITE + '/p/' + encodeURIComponent(String(postId)),
    SITE + '/?p=' + encodeURIComponent(String(postId)),
    SITE + '/api/og?p=' + encodeURIComponent(String(postId)),
    SITE + '/sitemap.xml'
  ];
  if (!zone || !token) {
    return { skipped: true, reason: 'missing_cf_credentials', files };
  }
  try {
    const r = await fetch('https://api.cloudflare.com/client/v4/zones/' + encodeURIComponent(zone) + '/purge_cache', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + token,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ files })
    });
    const j = await r.json().catch(function () {
      return {};
    });
    return { ok: !!(r.ok && j && j.success), status: r.status, files, result: j };
  } catch (e) {
    return { ok: false, error: String(e && e.message ? e.message : e), files };
  }
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

/**
 * Fast pin invalidation only.
 * NEVER scan full __PIN_BOARD__ / __PIN_REWARDS__ lists — that took 30s+ in production
 * and caused mobile clients to abort with a generic "Could not delete" while the
 * charge/delete may already have completed on the server.
 */
async function retirePinsForDeletedPost(postId) {
  const boards = ['__PIN_BOARD__', '__PIN_REWARDS__'];
  const summary = { boards: {}, removed: 0, mode: 'fast_invalidate' };
  await Promise.all(
    boards.map(async (board) => {
      try {
        await cfFetch('/notifs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Origin: SITE },
          body: JSON.stringify({
            to_username: board,
            from_username: 'system',
            type: 'pin_invalidated',
            post_id: String(postId),
            message: JSON.stringify({
              post_id: String(postId),
              invalidated: true,
              reason: 'post_deleted',
              at: Date.now()
            })
          })
        });
        summary.boards[board] = 0;
      } catch (_) {
        summary.boards[board] = -1;
      }
    })
  );
  try {
    await cfFetch('/posts/' + encodeURIComponent(String(postId)), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Origin: SITE },
      body: JSON.stringify({ featured_until: 0 })
    });
  } catch (_) {}
  return summary;
}

function withTimeout(promise, ms, fallback) {
  return new Promise((resolve) => {
    let done = false;
    const t = setTimeout(() => {
      if (done) return;
      done = true;
      resolve(fallback);
    }, ms);
    Promise.resolve(promise)
      .then((v) => {
        if (done) return;
        done = true;
        clearTimeout(t);
        resolve(v);
      })
      .catch(() => {
        if (done) return;
        done = true;
        clearTimeout(t);
        resolve(fallback);
      });
  });
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return json(res, 204, {});
  if (req.method !== 'POST') return json(res, 405, { error: 'method_not_allowed' });

  let body;
  try {
    body = await readBody(req);
  } catch (_) {
    return json(res, 400, { error: 'bad_json' });
  }

  const rawUser = walletUser(body.user || body.username);
  const userKey = normUser(rawUser); // ownership comparisons only
  const postId = String(body.postId || body.id || '').trim();
  const reason = String(body.reason || 'owner')
    .trim()
    .toLowerCase();
  const idempotencyKey = String(body.idempotencyKey || body.ref || '').trim() || null;

  if (!rawUser) return json(res, 400, { error: 'missing_user' });
  if (!postId) return json(res, 400, { error: 'missing_post_id' });
  if (!SB_URL || !SB_KEY) {
    return json(res, 500, { error: 'supabase_env', detail: 'Missing SUPABASE_URL / key' });
  }

  let row = null;
  try {
    row = await loadPostRow(postId);
  } catch (e) {
    return json(res, 500, { error: 'load_failed', detail: String(e && e.message ? e.message : e) });
  }

  const spendIdem =
    idempotencyKey || `delete-post:${postId}:${userKey}:${DELETE_COST_FC}`;

  // Idempotent re-entry after a successful delete (double-click / reload).
  if (!row) {
    const candidates = walletUserCandidates(rawUser);
    for (let i = 0; i < candidates.length; i++) {
      const priorSpend = await findLedgerSpend(
        candidates[i],
        'delete',
        deleteSpendRef(candidates[i], postId, spendIdem),
        DELETE_COST_FC
      );
      if (priorSpend) {
        return json(res, 200, {
          ok: true,
          postId,
          already_deleted: true,
          charged: 0,
          reused: true,
          balance: null,
          free: false,
          reason: 'already_deleted'
        });
      }
    }
    return json(res, 404, { error: 'not_found' });
  }

  const owner = normUser(row.username);
  const tier = resolveTier(row);
  const ownerToken = String(body.ownerToken || body.owner_token || '').trim();
  let tokenOk = false;
  if (ownerToken && row.owner_token_hash) {
    try {
      tokenOk = hashOwnerToken(ownerToken) === String(row.owner_token_hash || '').trim().toLowerCase();
    } catch (_) {
      tokenOk = false;
    }
  }
  // Anonymous visitors may publish but never delete — even with a local owner token.
  function isAnonymousIdentity(u) {
    const n = normUser(u);
    return (
      !n ||
      n === 'guest' ||
      n === 'anon' ||
      n.indexOf('anon_') === 0 ||
      n.indexOf('anon:') === 0 ||
      /^anon\d*$/i.test(n)
    );
  }
  const accountType = String(body.account_type || body.accountType || '').toLowerCase();
  const requesterAnon =
    accountType === 'anonymous' ||
    isAnonymousIdentity(rawUser) ||
    String(body.role || '').toLowerCase() === 'guest';
  const isOwner = !requesterAnon && (owner === userKey || tokenOk);
  // Block anonymous delete attempts explicitly (owner-token spoofing included).
  if (requesterAnon) {
    return json(res, 403, {
      error: 'anonymous_cannot_delete',
      detail: 'Anonymous accounts can publish proofs but cannot delete posts. Register to manage your own posts.'
    });
  }
  let cfAdminOk = false;
  try {
    cfAdminOk = await verifyCfAdminToken(bearerToken(req));
  } catch (_) {
    cfAdminOk = false;
  }
  // CRITICAL: never trust body.user alone (e.g. user:"admin") for moderation deletes.
  // Require ADMIN_KEY or a verified Cloudflare Worker admin bearer token.
  const adminCredOk = adminKeyOk(body.adminKey) || cfAdminOk;
  const freeOverride = FREE_REASONS.has(reason) && adminCredOk;
  const paidForce = reason === 'paid' || reason === 'paid_remove' || reason === 'fc';

  // Non-owners may delete ONLY by paying 50 FC (automatic — no admin queue).
  // Free owner deletes and admin moderation stay unchanged.
  if (!freeOverride && !isOwner && !paidForce) {
    // Legacy clients that omit reason=paid still get the paid path when not owner.
    // (FC button always sends reason=paid; bare calls without ownership stay forbidden.)
    return json(res, 403, {
      error: 'forbidden',
      detail: 'Only the owner, a paid FC removal, or admin moderation/privacy can delete.'
    });
  }

  let charged = 0;
  let spend = null;
  let deleteReason = freeOverride ? reason : isOwner ? 'owner' : 'paid';

  if (!freeOverride) {
    let cost = 0;
    if (!isOwner || paidForce) {
      // Paid automatic removal — always 50 FC (server price).
      cost = DELETE_COST_FC;
      deleteReason = 'paid';
    } else {
      cost = ownerDeleteCost(row);
    }
    if (cost > 0) {
      spend = await spendDeleteFc(rawUser, postId, spendIdem);
      if (!spend.ok) {
        const code = spend.error || 'spend_failed';
        const status = code === 'insufficient' ? 402 : spend.status || 400;
        return json(res, status, {
          error: code,
          detail: spend.detail || null,
          need: spend.need ?? cost,
          have: spend.have != null ? spend.have : spend.balance,
          balance: spend.balance,
          cost,
          tier,
          wallet_user: spend.user || rawUser,
          source: spend.source || null,
          buyUrl: '/coins'
        });
      }
      charged = cost;
    }
  }

  const delErr = await deletePostRow(postId);
  if (delErr) {
    let refund = null;
    if (charged > 0 && spend && !spend.reused) {
      try {
        const refundUser = walletUser((spend && spend.user) || rawUser);
        if (spend.source === 'supabase') {
          // Restore Supabase wallet if that is where we charged.
          const client = sbClient();
          if (client) {
            const q = await client.from('coin_wallets').select('balance').eq('user_id', refundUser).maybeSingle();
            const bal = Number((q.data && q.data.balance) || 0) || 0;
            const upd = await client
              .from('coin_wallets')
              .update({ balance: bal + DELETE_COST_FC })
              .eq('user_id', refundUser)
              .select('balance')
              .maybeSingle();
            refund = {
              ok: !upd.error,
              balance: upd.data ? Number(upd.data.balance) : bal + DELETE_COST_FC,
              source: 'supabase'
            };
          } else {
            const bal = await sbWalletBalance(refundUser);
            const rest = await sbRest('/rest/v1/coin_wallets?user_id=eq.' + encodeURIComponent(refundUser), {
              method: 'PATCH',
              body: JSON.stringify({ balance: bal + DELETE_COST_FC })
            });
            refund = { ok: rest.ok, balance: bal + DELETE_COST_FC, source: 'supabase' };
          }
        } else {
          refund = await refundDeleteFc(refundUser, postId);
        }
      } catch (e) {
        refund = { ok: false, error: String(e && e.message ? e.message : e) };
      }
    }
    return json(res, 500, {
      error: 'delete_failed',
      detail: delErr.message || String(delErr),
      charged: refund && refund.ok ? 0 : charged,
      refunded: !!(refund && refund.ok),
      refund,
      tier,
      balance: (refund && refund.balance != null ? refund.balance : null) ?? (spend && spend.balance)
    });
  }

  // Best-effort cleanup with hard caps — never block the client past a few seconds.
  // (Full pin-board scans previously made this endpoint ~30s and mobile aborted.)
  const pinCleanup = await withTimeout(
    retirePinsForDeletedPost(postId),
    2500,
    { skipped: true, reason: 'pin_cleanup_timeout', mode: 'fast_invalidate' }
  );
  const cachePurge = await withTimeout(
    purgeDeletedPostCaches(postId),
    1500,
    { skipped: true, reason: 'cache_purge_timeout' }
  );

  // Hint for Google Search Console Removals (manual): list the URL that must drop.
  const removalUrl = SITE + '/post/' + encodeURIComponent(String(postId));

  return json(res, 200, {
    ok: true,
    postId,
    tier,
    free_deletion_enabled: freeDeletionEnabled(row),
    charged,
    reason: deleteReason,
    balance: spend && spend.balance,
    wallet_user: (spend && spend.user) || rawUser,
    source: (spend && spend.source) || null,
    free: !!freeOverride || charged === 0,
    reused: !!(spend && spend.reused),
    via_owner_token: !!tokenOk,
    auto_deleted: true,
    admin_notified: false,
    pinCleanup,
    cachePurge,
    removalUrl,
    gscHint: 'Request temporary removal for ' + removalUrl + ' in Google Search Console if it still appears in search.'
  });
};
