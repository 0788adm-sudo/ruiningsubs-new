/**
 * Secure post deletion with Deletion Tier + FC spend.
 *
 * POST /api/delete-post
 * Body: {
 *   user: string,
 *   postId: string,
 *   reason?: 'owner'|'moderation'|'privacy',
 *   adminKey?: string,
 *   idempotencyKey?: string
 * }
 *
 * - deletable / legacy-free: owner deletes free
 * - locked / permanent / legacy-timed: owner pays 50 FC (server-side price only)
 * - moderation / privacy: free for admins — Permanent never blocks these
 * - spend is idempotent via CF wallet ledger; post is only deleted after successful spend
 */
const CF_API = process.env.CF_API || 'https://ruiningsubs-api.0788adm.workers.dev';
const SITE = process.env.SITE_URL || 'https://www.ruinexpose.com';
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
  'Content-Type': 'application/json'
};

function json(res, status, body) {
  res.statusCode = status;
  Object.entries(cors).forEach(([k, v]) => res.setHeader(k, v));
  res.end(JSON.stringify(body));
}

function sb() {
  if (!createClient) throw new Error('Missing @supabase/supabase-js');
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error('Missing Supabase env');
  return createClient(url, key, { auth: { persistSession: false } });
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

/** Legacy timed-remove detection (mirrors client isPaidRemovePost). */
function legacyRequiresFc(row) {
  const tags = parseTags(row?.tags).map((t) => t.toLowerCase());
  if (tags.some((t) => t === 'remove:free' || t === 'delete:free' || t === 'free-remove')) return false;
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
  if (tier === 'deletable') return 0;
  if (tier === 'locked' || tier === 'permanent') return DELETE_COST_FC;
  return legacyRequiresFc(row) ? DELETE_COST_FC : 0;
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

async function findLedgerSpend(user, action, ref, minCoins) {
  const res = await cfFetch('/wallet/ledger?user=' + encodeURIComponent(user));
  const rows = (res.json && res.json.ledger) || [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] || {};
    if (String(row.kind || '') !== 'spend') continue;
    if (String(row.action || '') !== String(action)) continue;
    if (String(row.ref_id || row.ref || '') !== String(ref || '')) continue;
    if (Number(row.coins || 0) < Number(minCoins || 0)) continue;
    return row;
  }
  return null;
}

/** Same atomic spend path as /api/fc-spend — never trust client price. */
async function spendDeleteFc(user, postId, idemRef) {
  const action = 'delete';
  const cost = DELETE_COST_FC;
  const ref = String(idemRef || `delete-post:${postId}:${user}`).slice(0, 120);

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
      balance: Number((res.json && res.json.balance) || 0) || 0
    };
  }
  return { ok: false, error: err || 'spend_failed', status: res.status };
}

async function deletePostRow(client, postId) {
  const { error } = await client.from('posts').delete().eq('id', postId);
  return error;
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

  let client;
  try {
    client = sb();
  } catch (e) {
    return json(res, 500, { error: 'supabase_env', detail: String(e.message || e) });
  }

  let row = null;
  {
    let q = await client
      .from('posts')
      .select('id,username,tags,expires_at,extend_amount,deletion_tier')
      .eq('id', postId)
      .maybeSingle();
    if (q.error && /deletion_tier/i.test(String(q.error.message || ''))) {
      q = await client
        .from('posts')
        .select('id,username,tags,expires_at,extend_amount')
        .eq('id', postId)
        .maybeSingle();
    }
    if (q.error) return json(res, 500, { error: 'load_failed', detail: q.error.message });
    row = q.data;
  }
  if (!row) return json(res, 404, { error: 'not_found' });

  const owner = normUser(row.username);
  const tier = resolveTier(row);
  const isOwner = owner === user;
  const freeOverride =
    FREE_REASONS.has(reason) && (isAdminUser(user) || adminKeyOk(body.adminKey));

  if (!freeOverride && !isOwner) {
    return json(res, 403, {
      error: 'forbidden',
      detail: 'Only the owner (or admin moderation/privacy) can delete.'
    });
  }

  let charged = 0;
  let spend = null;

  if (!freeOverride) {
    const cost = ownerDeleteCost(row);
    if (cost > 0) {
      spend = await spendDeleteFc(user, postId, idempotencyKey || `delete-post:${postId}:${user}:${cost}`);
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

  const delErr = await deletePostRow(client, postId);
  if (delErr) {
    return json(res, 500, {
      error: 'delete_failed_after_charge',
      detail: delErr.message,
      charged,
      tier,
      balance: spend && spend.balance
    });
  }

  return json(res, 200, {
    ok: true,
    postId,
    tier,
    charged,
    reason: freeOverride ? reason : 'owner',
    balance: spend && spend.balance,
    free: !!freeOverride || charged === 0,
    reused: !!(spend && spend.reused)
  });
};
