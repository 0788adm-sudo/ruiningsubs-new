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

function normUser(u) {
  return String(u || '')
    .trim()
    .replace(/^@+/, '')
    .toLowerCase();
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

/** Same atomic spend path as /api/fc-spend — never trust client price. */
async function spendDeleteFc(user, postId, idemRef) {
  const action = 'delete';
  const cost = DELETE_COST_FC;
  const ref = deleteSpendRef(user, postId, idemRef);

  const existing = await findLedgerSpend(user, action, ref, cost);
  if (existing) {
    return { ok: true, reused: true, balance: null, coins: cost, ref };
  }

  const res = await cfFetch('/wallet', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: SITE },
    body: JSON.stringify({ user, spend: cost, action, ref })
  });

  if (res.json && res.json.ok) {
    return {
      ok: true,
      reused: false,
      balance: res.json.balance != null ? Number(res.json.balance) : null,
      coins: cost,
      ref
    };
  }

  const err = String((res.json && (res.json.error || res.json.message)) || '');
  if (/insufficient|not enough|balance/i.test(err) || res.status === 402 || res.status === 400) {
    return {
      ok: false,
      error: 'insufficient',
      need: cost,
      balance: Number((res.json && res.json.balance) || 0) || 0,
      ref
    };
  }
  return { ok: false, error: err || 'spend_failed', status: res.status, ref };
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
  const colsFull = 'id,username,tags,expires_at,extend_amount,deletion_tier,free_deletion_enabled,owner_token_hash';
  const colsTier = 'id,username,tags,expires_at,extend_amount,deletion_tier';
  const colsBase = 'id,username,tags,expires_at,extend_amount';
  const client = sbClient();
  if (client) {
    let q = await client.from('posts').select(colsFull).eq('id', postId).maybeSingle();
    if (q.error && /free_deletion_enabled|owner_token_hash/i.test(String(q.error.message || ''))) {
      q = await client.from('posts').select(colsTier).eq('id', postId).maybeSingle();
    }
    if (q.error && /deletion_tier/i.test(String(q.error.message || ''))) {
      q = await client.from('posts').select(colsBase).eq('id', postId).maybeSingle();
    }
    if (q.error) throw new Error(q.error.message || 'load_failed');
    return q.data || null;
  }
  // REST fallback (same pattern as /api/extend) — works without the npm package.
  let rest = await sbRest(
    '/rest/v1/posts?select=' + encodeURIComponent(colsFull) + '&id=eq.' + encodeURIComponent(postId) + '&limit=1'
  );
  if (!rest.ok && rest.status === 400) {
    rest = await sbRest(
      '/rest/v1/posts?select=' + encodeURIComponent(colsTier) + '&id=eq.' + encodeURIComponent(postId) + '&limit=1'
    );
  }
  if (!rest.ok && rest.status === 400) {
    rest = await sbRest(
      '/rest/v1/posts?select=' + encodeURIComponent(colsBase) + '&id=eq.' + encodeURIComponent(postId) + '&limit=1'
    );
  }
  if (!rest.ok) throw new Error('load_failed_http_' + rest.status);
  const rows = Array.isArray(rest.data) ? rest.data : [];
  return rows[0] || null;
}

async function deletePostRow(postId) {
  const client = sbClient();
  if (client) {
    const { error } = await client.from('posts').delete().eq('id', postId);
    if (error) return error;
  } else {
    const rest = await sbRest('/rest/v1/posts?id=eq.' + encodeURIComponent(String(postId)), {
      method: 'DELETE'
    });
    if (!rest.ok) {
      return { message: 'delete_failed_http_' + rest.status, details: rest.data };
    }
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

/** Drop pin-board + pin-reward refs so deleted posts never reappear as Spotlight pins. */
async function retirePinsForDeletedPost(postId) {
  const boards = ['__PIN_BOARD__', '__PIN_REWARDS__'];
  const summary = { boards: {}, removed: 0 };
  for (let b = 0; b < boards.length; b++) {
    const board = boards[b];
    let removed = 0;
    try {
      const res = await cfFetch('/notifs?to=' + encodeURIComponent(board));
      const list = (res.json && res.json.notifs) || [];
      for (let i = 0; i < list.length; i++) {
        const n = list[i];
        if (!n || !n.id) continue;
        const msg = parseBoardMsg(n.message);
        const pid = String((msg && (msg.id || msg.post_id)) || n.post_id || '');
        if (pid !== String(postId) && String(n.post_id || '') !== String(postId)) continue;
        try {
          const dr = await cfFetch('/notifs/' + encodeURIComponent(String(n.id)), { method: 'DELETE' });
          if (dr && dr.ok) removed++;
        } catch (_) {}
      }
    } catch (_) {}
    // Mark reward invalidated (append-only audit; does not restore the pin).
    try {
      await cfFetch('/notifs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: SITE },
        body: JSON.stringify({
          to_username: board === '__PIN_REWARDS__' ? '__PIN_REWARDS__' : '__PIN_BOARD__',
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
    } catch (_) {}
    summary.boards[board] = removed;
    summary.removed += removed;
  }
  // Best-effort clear featured on CF post mirror (row may already be gone in Supabase).
  try {
    await cfFetch('/posts/' + encodeURIComponent(String(postId)), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Origin: SITE },
      body: JSON.stringify({ featured_until: 0 })
    });
  } catch (_) {}
  return summary;
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

  const user = normUser(body.user || body.username);
  const postId = String(body.postId || body.id || '').trim();
  const reason = String(body.reason || 'owner')
    .trim()
    .toLowerCase();
  const idempotencyKey = String(body.idempotencyKey || body.ref || '').trim() || null;

  if (!user) return json(res, 400, { error: 'missing_user' });
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

  const spendRef = deleteSpendRef(
    user,
    postId,
    idempotencyKey || `delete-post:${postId}:${user}:${DELETE_COST_FC}`
  );

  // Idempotent re-entry after a successful delete (double-click / reload).
  if (!row) {
    const priorSpend = await findLedgerSpend(user, 'delete', spendRef, DELETE_COST_FC);
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
  const isOwner = owner === user || tokenOk;
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
      spend = await spendDeleteFc(user, postId, spendRef);
      if (!spend.ok) {
        const code = spend.error || 'spend_failed';
        const status = code === 'insufficient' ? 402 : spend.status || 400;
        return json(res, status, {
          error: code,
          detail: spend.detail || null,
          need: spend.need ?? cost,
          have: spend.balance,
          balance: spend.balance,
          cost,
          tier,
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
        refund = await refundDeleteFc(user, postId);
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

  // Never leave Spotlight / pin lists pointing at a deleted post.
  let pinCleanup = null;
  try {
    pinCleanup = await retirePinsForDeletedPost(postId);
  } catch (e) {
    pinCleanup = { ok: false, error: String(e && e.message ? e.message : e) };
  }

  // Post row is gone — purge CDN/edge caches so old OG/HTML cannot resurrect.
  let cachePurge = null;
  try {
    cachePurge = await purgeDeletedPostCaches(postId);
  } catch (e) {
    cachePurge = { ok: false, error: String(e && e.message ? e.message : e) };
  }

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
