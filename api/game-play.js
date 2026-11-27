// Game play intake: roulette / dice / tic_tac_toe.
// Free uses: 3 per game per cycle, then 24h recovery (independent counters).
// Anonymous sessions, pin rewards, XP-safe. Does NOT touch PayPal / Throne payment flows.

const CF_API = process.env.CF_API || 'https://ruiningsubs-api.0788adm.workers.dev';
const SITE = process.env.SITE_URL || 'https://www.ruinexpose.com';
const FC_ROULETTE = Number(process.env.FC_COST_ROULETTE || 10);
const FC_ROULETTE_PACK = Number(process.env.FC_COST_ROULETTE_PACK || 10);
const ROULETTE_PACK_SPINS = Number(process.env.ROULETTE_PACK_SPINS || 10);
const GAME_PACK_USES = Number(process.env.GAME_PACK_USES || ROULETTE_PACK_SPINS || 10);
const FREE_USES_PER_GAME = Number(process.env.FREE_USES_PER_GAME || 3);
const FREE_RECOVERY_MS = Number(process.env.FREE_RECOVERY_MS || (24 * 60 * 60 * 1000));
const FC_DICE = Number(process.env.FC_COST_DICE || 10);
const FC_DICE_PACK = Number(process.env.FC_COST_DICE_PACK || 10);
const FC_TTT_PACK = Number(process.env.FC_COST_TTT_PACK || 10);
/** Custom 30-option purchases removed — kept only so old env vars do not break boot. */
const FC_CUSTOM = Number(process.env.FC_COST_CUSTOM_ROULETTE || 250);
const CUSTOM_GAMES_ENABLED = false;
/** Prize slots (pin / +10d) are weighted higher so users win more often without guaranteeing wins. */
const ROULETTE_PRIZE_WEIGHT = Math.max(1, Number(process.env.ROULETTE_PRIZE_WEIGHT || 4) || 4);
const TRIKI_PIN_HOURS = Number(process.env.TRIKI_PIN_HOURS || 48);
const ROULETTE_PIN_HOURS = Number(process.env.ROULETTE_PIN_HOURS || 48);
const EXTEND_10D_MS = 10 * 24 * 60 * 60 * 1000;
const BOARD_PLAYS = '__GAME_PLAYS__';
const BOARD_FREE = '__GAME_FREE_USES__';
const BOARD_FREE_LEGACY = '__GAME_FREE_DAY__';
const BOARD_PACKS = '__ROULETTE_PACKS__';
const BOARD_TRIKI = '__TRIKI_SESSIONS__';
const BOARD_PIN_REWARDS = '__PIN_REWARDS__';
const BOARD_EXTEND_REWARDS = '__GAME_EXTEND_REWARDS__';
const LIVE_GAMES = { roulette: 1, dice: 1, tic_tac_toe: 1, triki: 1 };

/** Server-side Exposure Dice catalogs — coherent Wear / Pose / Proof pairs. */
var DICE_WEAR = [
  'T-shirt pulled up to the chest',
  'Hoodie only — nothing underneath',
  'Underwear only',
  'Socks and underwear',
  'Shirt open, chest bare',
  'Towel wrapped loosely',
  'Collar or belt around the neck + underwear',
  'Just a tank top, bottoms off',
  'Pants down to the knees',
  'Blindfold + underwear',
  'Mirror selfie, clothes halfway off',
  'Hands covering only — otherwise bare'
];
var DICE_POSE = [
  'Kneel. Hands on thighs. Look at the camera.',
  'Stand for inspection. Hands behind your head.',
  'On all fours on the bed or floor. Look back at the camera.',
  'Sit on the edge of the bed. Hands on thighs.',
  'Bent over a chair or bed edge. Steady pose.',
  'Face the wall. Hands at your sides. Ass toward camera.',
  'Lie on your back. Knees bent. Still.',
  'Nadu: kneel, chest out, palms on thighs.',
  'Humble: forehead down, hips up — hold still.',
  'Wait in a doorway. Hands at your sides.',
  'Present: hold the pose for inspection.',
  'Table: flat on your back on the bed, still.'
];
var DICE_PROOF = [
  'Hold the pose 20 seconds, then take one clear photo and publish it.',
  'Hold the pose 30 seconds on video, then publish the clip.',
  'Front photo of the pose. Publish it.',
  'Front and side photos of the same pose. Publish both.',
  'Write RUINED on paper, hold it in frame with the pose, photo, publish.',
  'Count out loud to 15 while holding the pose on video. Publish.',
  '15s kneeling/standing apology video in this outfit and pose. Publish.',
  'Three angles of the same pose. Publish all three.',
  'Screenshot this roll and include it with your proof photo. Publish both.',
  'Hold 30s, then freeze for a still photo. Publish photo (video optional).',
  'Caption the post: exposed on RuiningSubs — include wear + pose. Publish.',
  'Mirror proof: same pose in a mirror selfie. Publish.'
];
/** Compatible pose indices (0-based) for each wear face — avoids absurd combos. */
var DICE_COMPAT = [
  [0, 1, 3, 7, 9, 10],
  [0, 1, 3, 7, 9, 10],
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  [0, 1, 3, 7, 9, 10],
  [0, 1, 3, 7, 9, 10],
  [0, 1, 3, 7, 9],
  [0, 1, 7, 9, 10],
  [0, 1, 3, 7, 9, 10],
  [0, 1, 2, 4, 5, 9],
  [0, 1, 7, 9, 10],
  [0, 1, 3, 7, 9, 10],
  [0, 1, 2, 3, 7, 9, 10]
];

function pickCoherentDiceRoll() {
  var wearIdx = Math.floor(Math.random() * 12);
  var compat = DICE_COMPAT[wearIdx] || [0, 1, 3, 7];
  var poseIdx = compat[Math.floor(Math.random() * compat.length)];
  var proofIdx = Math.floor(Math.random() * 12);
  return {
    wear_idx: wearIdx + 1,
    pose_idx: poseIdx + 1,
    proof_idx: proofIdx + 1,
    wear: DICE_WEAR[wearIdx],
    pose: DICE_POSE[poseIdx],
    proof: DICE_PROOF[proofIdx]
  };
}

/** Server-authoritative weighted roulette index. Prize indices get elevated weight. */
function pickWeightedRouletteIdx(optionCount, prizeIndices) {
  optionCount = Math.max(2, Math.min(60, Math.floor(Number(optionCount) || 30)));
  var prizes = [];
  var seen = {};
  (Array.isArray(prizeIndices) ? prizeIndices : []).forEach(function (raw) {
    var idx = Math.floor(Number(raw));
    if (!isFinite(idx) || idx < 0 || idx >= optionCount || seen[idx]) return;
    seen[idx] = 1;
    prizes.push(idx);
  });
  if (!prizes.length) {
    return Math.floor(Math.random() * optionCount);
  }
  var weights = [];
  var total = 0;
  for (var i = 0; i < optionCount; i++) {
    var w = seen[i] ? ROULETTE_PRIZE_WEIGHT : 1;
    weights.push(w);
    total += w;
  }
  var roll = Math.random() * total;
  var acc = 0;
  for (var j = 0; j < optionCount; j++) {
    acc += weights[j];
    if (roll < acc) return j;
  }
  return optionCount - 1;
}

function packCostForGame(game) {
  game = normalizeGame(game);
  if (game === 'dice') return FC_DICE_PACK;
  if (game === 'tic_tac_toe') return FC_TTT_PACK;
  return FC_ROULETTE_PACK;
}

function packActionForGame(game) {
  game = normalizeGame(game);
  if (game === 'dice') return 'dice_pack';
  if (game === 'tic_tac_toe') return 'tic_tac_toe_pack';
  return 'roulette_pack';
}

var locks = new Map();
var recent = new Map();

function json(res, code, body, extraHeaders) {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (extraHeaders && typeof extraHeaders === 'object') {
    Object.keys(extraHeaders).forEach(function (k) {
      res.setHeader(k, extraHeaders[k]);
    });
  }
  res.end(JSON.stringify(body));
}

var ANON_COOKIE = 'rs_anon_id';
var ANON_MAX_AGE = 60 * 60 * 24 * 365;
var BOARD_ANON_LINKS = '__ANON_LINKS__';
var BOARD_USERNAME_ALIASES = '__USERNAME_ALIASES__';
/** Permanent public SubN labels for anonymous users (display-only; does not rewrite posts). */
var BOARD_ANON_SUBS = '__ANON_SUBS__';

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

function parseCookies(req) {
  var raw = String((req.headers && (req.headers.cookie || req.headers.Cookie)) || '');
  var out = {};
  raw.split(';').forEach(function (part) {
    var i = part.indexOf('=');
    if (i < 0) return;
    var k = part.slice(0, i).trim();
    var v = part.slice(i + 1).trim();
    if (k) {
      try { out[k] = decodeURIComponent(v || ''); } catch (e) { out[k] = v || ''; }
    }
  });
  return out;
}

function sanitizeAnonId(v) {
  // Lowercase so wallet / pack boards stay consistent across user= and anon_id=.
  return String(v || '').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 48);
}

function mintAnonId() {
  return 'a' + Date.now().toString(36) + Math.random().toString(36).slice(2, 12) + Math.random().toString(36).slice(2, 8);
}

function isValidAnonId(id) {
  id = sanitizeAnonId(id);
  return id.length >= 8 && id.length <= 48;
}

function anonCookieHeader(id, secure) {
  var parts = [
    ANON_COOKIE + '=' + encodeURIComponent(id),
    'Path=/',
    'Max-Age=' + ANON_MAX_AGE,
    'HttpOnly',
    'SameSite=Lax'
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

function resolveAnonIdentity(req, body, query) {
  body = body || {};
  query = query || {};
  var cookies = parseCookies(req);
  var fromCookie = sanitizeAnonId(cookies[ANON_COOKIE]);
  var fromClient = sanitizeAnonId(
    body.anon_id || body.anonId || body.anonymous_user_id || query.anon_id || query.anonId || ''
  );
  var id = '';
  if (isValidAnonId(fromCookie)) id = fromCookie;
  else if (isValidAnonId(fromClient)) id = fromClient;
  else id = mintAnonId();
  var created = !(isValidAnonId(fromCookie) || isValidAnonId(fromClient));
  return { id: id, created: created, username: 'anon_' + id };
}

function isSecureReq(req) {
  var proto = String((req.headers && (req.headers['x-forwarded-proto'] || req.headers['X-Forwarded-Proto'])) || '').toLowerCase();
  return proto.indexOf('https') === 0 || String(process.env.VERCEL || '') === '1';
}

async function loadAnonSubBoard() {
  var rows = [];
  try {
    rows = await fetchBoard(BOARD_ANON_SUBS);
  } catch (e) {
    rows = [];
  }
  var byId = {};
  var max = 0;
  (rows || []).forEach(function (n) {
    var msg = parseMsg(n && n.message);
    if (!msg) return;
    var id = sanitizeAnonId(msg.anonymous_user_id || msg.anon_id || msg.id || '');
    var num = Number(msg.sub_number || msg.n || 0) || 0;
    if (!id || num < 1) return;
    if (!byId[id] || num < byId[id]) byId[id] = num;
    if (num > max) max = num;
  });
  return { byId: byId, max: max };
}

async function getOrAssignSubNumber(anonId) {
  anonId = sanitizeAnonId(anonId);
  if (!isValidAnonId(anonId)) return null;
  var board = await loadAnonSubBoard();
  if (board.byId[anonId]) {
    return { sub_number: board.byId[anonId], display_name: 'Sub' + board.byId[anonId], created: false };
  }
  var next = (board.max || 0) + 1;
  try {
    await postBoard(BOARD_ANON_SUBS, 'anon_' + anonId, 'anon_sub', String(next), {
      anonymous_user_id: anonId,
      sub_number: next,
      display_name: 'Sub' + next,
      at: Date.now()
    });
  } catch (e) {}
  // Re-read in case of a concurrent assign — keep the lowest permanent number.
  try {
    board = await loadAnonSubBoard();
    if (board.byId[anonId]) {
      return { sub_number: board.byId[anonId], display_name: 'Sub' + board.byId[anonId], created: board.byId[anonId] === next };
    }
  } catch (e2) {}
  return { sub_number: next, display_name: 'Sub' + next, created: true };
}

async function ensureAnonSubNumbers(ids) {
  var list = Array.isArray(ids) ? ids : [];
  var out = {};
  var seen = {};
  for (var i = 0; i < list.length; i++) {
    var id = sanitizeAnonId(list[i]);
    if (!isValidAnonId(id) || seen[id]) continue;
    seen[id] = 1;
    var row = await getOrAssignSubNumber(id);
    if (row && row.sub_number) out[id] = row.sub_number;
  }
  return out;
}

async function handleAnonSubs(req, res, body, query) {
  body = body || {};
  query = query || {};
  var action = String(body.action || query.action || '').toLowerCase();
  if (action === 'list_anon_subs' || action === 'anon_subs') {
    var board = await loadAnonSubBoard();
    var subs = Object.keys(board.byId).map(function (id) {
      return {
        anonymous_user_id: id,
        sub_number: board.byId[id],
        display_name: 'Sub' + board.byId[id]
      };
    });
    subs.sort(function (a, b) { return a.sub_number - b.sub_number; });
    return json(res, 200, { ok: true, subs: subs, max: board.max || 0 });
  }
  var rawIds = body.anon_ids || body.ids || body.anonymous_user_ids || query.anon_ids || '';
  var ids = Array.isArray(rawIds)
    ? rawIds
    : String(rawIds || '')
        .split(',')
        .map(function (s) { return s.trim(); })
        .filter(Boolean);
  if (body.anon_id || body.anonymous_user_id || query.anon_id) {
    ids.push(body.anon_id || body.anonymous_user_id || query.anon_id);
  }
  var map = await ensureAnonSubNumbers(ids);
  var subs = Object.keys(map).map(function (id) {
    return { anonymous_user_id: id, sub_number: map[id], display_name: 'Sub' + map[id] };
  });
  return json(res, 200, { ok: true, subs: subs, map: map });
}

async function handleAnonIdentity(req, res, body, query) {
  body = body || {};
  query = query || {};
  var action = String(body.action || query.action || '').toLowerCase();
  var resolved = resolveAnonIdentity(req, body, query);
  var cookie = anonCookieHeader(resolved.id, isSecureReq(req));
  if (action === 'link_anon') {
    var registered = String(body.registered_user || body.user || body.username || '')
      .replace(/^@/, '')
      .replace(/[^a-zA-Z0-9_]/g, '')
      .slice(0, 40);
    if (!registered || isAnonUser(normUser(registered))) {
      return json(res, 400, { ok: false, error: 'invalid_registered_user' }, { 'Set-Cookie': cookie });
    }
    try {
      await postBoard(BOARD_ANON_LINKS, registered, 'anon_link', resolved.id, {
        anonymous_user_id: resolved.id,
        registered_user: registered,
        at: Date.now()
      });
    } catch (e) {}
    var linkedSub = null;
    try { linkedSub = await getOrAssignSubNumber(resolved.id); } catch (e) {}
    return json(res, 200, {
      ok: true,
      anonymous_user_id: resolved.id,
      account_type: 'anonymous',
      linked_to: registered,
      username: resolved.username,
      sub_number: linkedSub && linkedSub.sub_number ? linkedSub.sub_number : null,
      display_name: linkedSub && linkedSub.display_name ? linkedSub.display_name : null
    }, { 'Set-Cookie': cookie });
  }
  var sub = null;
  try { sub = await getOrAssignSubNumber(resolved.id); } catch (e) {}
  return json(res, 200, {
    ok: true,
    anonymous_user_id: resolved.id,
    account_type: 'anonymous',
    username: resolved.username,
    created: !!resolved.created,
    sub_number: sub && sub.sub_number ? sub.sub_number : null,
    display_name: sub && sub.display_name ? sub.display_name : null
  }, { 'Set-Cookie': cookie });
}

function readBody(req) {
  return new Promise(function (resolve, reject) {
    if (req.body && typeof req.body === 'object') return resolve(req.body);
    var chunks = [];
    req.on('data', function (c) { chunks.push(c); });
    req.on('end', function () {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

function normUser(u) {
  return String(u || '').replace(/^@/, '').trim().toLowerCase().slice(0, 64);
}

function dayKey(d) {
  d = d || new Date();
  return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0');
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

function normalizeGame(game) {
  game = String(game || '').toLowerCase().trim();
  if (game === 'triki') return 'tic_tac_toe';
  return game;
}

function isAnonUser(user) {
  return !user || user === 'anon' || user === 'guest' || user.indexOf('anon_') === 0 || user.indexOf('anon:') === 0;
}

function resolvePlayer(body, query, req) {
  var registered = normUser((body && (body.user || body.username)) || (query && (query.user || query.username)) || '');
  var anonRaw = String((body && (body.anon_id || body.anonId || body.anonymous_user_id || body.session_token)) || (query && (query.anon_id || query.anonId || query.anonymous_user_id)) || '').trim();
  anonRaw = sanitizeAnonId(anonRaw);
  // Prefer HttpOnly cookie over client-supplied id (anti-spoof for same browser).
  if (req) {
    try {
      var fromCookie = sanitizeAnonId(parseCookies(req)[ANON_COOKIE]);
      if (isValidAnonId(fromCookie)) anonRaw = fromCookie;
    } catch (e) {}
  }
  if (registered && !isAnonUser(registered)) {
    return { user: registered, anon: false, registered: true };
  }
  // Registered-looking payload that is actually anon_<id>
  if (registered && isAnonUser(registered)) {
    var stripped = sanitizeAnonId(registered.replace(/^anon[_:]/i, ''));
    if (isValidAnonId(stripped)) {
      return { user: 'anon_' + stripped, anon: true, registered: false, anonId: stripped };
    }
  }
  if (isValidAnonId(anonRaw)) {
    return { user: 'anon_' + anonRaw, anon: true, registered: false, anonId: anonRaw };
  }
  return { user: '', anon: true, registered: false };
}

async function cfFetch(path, opts) {
  var r = await fetch(CF_API + path, Object.assign({ cache: 'no-store' }, opts || {}));
  var j = await r.json().catch(function () { return {}; });
  return { ok: r.ok, status: r.status, json: j };
}

async function fetchBoard(board) {
  var res = await cfFetch('/notifs?to=' + encodeURIComponent(board));
  return (res.json && res.json.notifs) || [];
}

async function postBoard(board, from, type, postId, message) {
  return cfFetch('/notifs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: SITE },
    body: JSON.stringify({
      to_username: board,
      from_username: from,
      type: type,
      post_id: String(postId || ''),
      message: typeof message === 'string' ? message : JSON.stringify(message)
    })
  });
}

function sanitizeUsername(v) {
  return String(v || '')
    .replace(/^@+/, '')
    .replace(/[^a-zA-Z0-9_]/g, '')
    .slice(0, 40);
}

function permanentAccountId(body) {
  body = body || {};
  var authId = String(body.auth_user_id || body.user_id || body.uid || '').trim();
  if (/^[0-9a-f-]{16,}$/i.test(authId)) return authId.slice(0, 64);
  var anon = sanitizeAnonId(body.anon_id || body.anonymous_user_id || body.anonId || '');
  if (isValidAnonId(anon)) return 'anon_' + anon;
  return '';
}

async function sbRestIdentity(path, opts) {
  if (!SB_URL || !SB_KEY) throw new Error('Missing Supabase env');
  var r = await fetch(
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
  var text = await r.text();
  var data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch (_) {
    data = text;
  }
  return { ok: r.ok, status: r.status, data: data, error: r.ok ? null : String(text || '').slice(0, 240) };
}

async function verifySupabaseBearer(req) {
  var h = String((req.headers && (req.headers.authorization || req.headers.Authorization)) || '');
  var m = h.match(/^Bearer\s+(.+)$/i);
  var token = m ? String(m[1] || '').trim() : '';
  if (!token || token.length < 20) return null;
  try {
    var r = await fetch(SB_URL + '/auth/v1/user', {
      headers: { apikey: SB_KEY, Authorization: 'Bearer ' + token },
      cache: 'no-store'
    });
    if (!r.ok) return null;
    var j = await r.json().catch(function () { return null; });
    if (!j || !j.id) return null;
    var meta = j.user_metadata || {};
    return {
      id: String(j.id),
      email: String(j.email || ''),
      username: sanitizeUsername(meta.username || '')
    };
  } catch (e) {
    return null;
  }
}

async function loadAliasBoardMap() {
  var rows = await fetchBoard(BOARD_USERNAME_ALIASES);
  var map = {};
  (rows || []).forEach(function (n) {
    var msg = parseMsg(n && n.message);
    if (!msg) return;
    var alias = sanitizeUsername(msg.alias || msg.from || msg.old || '');
    var current = sanitizeUsername(msg.current_username || msg.to || msg.username || '');
    var uid = String(msg.user_id || '').trim();
    if (!alias || !current) return;
    map[normUser(alias)] = {
      alias: alias,
      current_username: current,
      user_id: uid || null,
      previous_username: sanitizeUsername(msg.previous_username || msg.from || alias) || alias
    };
  });
  return map;
}

async function recordUsernameAlias(alias, current, userId, previous) {
  alias = sanitizeUsername(alias);
  current = sanitizeUsername(current);
  if (!alias || !current) return;
  var payload = {
    alias: alias,
    current_username: current,
    user_id: userId || null,
    previous_username: sanitizeUsername(previous || alias) || alias,
    at: Date.now()
  };
  try {
    await postBoard(BOARD_USERNAME_ALIASES, current, 'username_alias', alias, payload);
  } catch (e) {}
  // Optional SQL table (migration 20261118). Ignore if missing.
  try {
    await sbRestIdentity('/rest/v1/username_aliases', {
      method: 'POST',
      headers: {
        apikey: SB_KEY,
        Authorization: 'Bearer ' + SB_KEY,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=minimal'
      },
      body: JSON.stringify({
        alias: alias,
        user_id: userId || ('name:' + normUser(current)),
        current_username: current,
        previous_username: sanitizeUsername(previous || alias) || alias,
        updated_at: new Date().toISOString()
      })
    });
  } catch (e) {}
}

async function sbUpdateByUsername(table, col, fromName, toName) {
  var path =
    '/rest/v1/' +
    encodeURIComponent(table) +
    '?' +
    encodeURIComponent(col) +
    '=eq.' +
    encodeURIComponent(fromName);
  var body = {};
  body[col] = toName;
  return sbRestIdentity(path, { method: 'PATCH', body: JSON.stringify(body) });
}

async function migrateUsernameRecords(fromName, toName, userId) {
  fromName = sanitizeUsername(fromName);
  toName = sanitizeUsername(toName);
  userId = String(userId || '').trim();
  var report = { from: fromName, to: toName, user_id: userId || null, steps: [] };

  function note(step, res) {
    report.steps.push({
      step: step,
      ok: !!(res && res.ok),
      status: res ? res.status : 0,
      error: res && res.error ? res.error : null,
      count: Array.isArray(res && res.data) ? res.data.length : null
    });
  }

  // Stamp + rename posts (do not delete). Prefer user_id when column exists.
  if (userId) {
    try {
      var stamp = await sbRestIdentity(
        '/rest/v1/posts?or=(username.eq.' +
          encodeURIComponent(fromName) +
          ',username.eq.' +
          encodeURIComponent(toName) +
          ',username.ilike.' +
          encodeURIComponent(fromName) +
          ')',
        {
          method: 'PATCH',
          body: JSON.stringify({ user_id: userId, username: toName })
        }
      );
      // If user_id column missing, fall back to username-only rename.
      if (!stamp.ok && /user_id/i.test(String(stamp.error || ''))) {
        stamp = await sbUpdateByUsername('posts', 'username', fromName, toName);
        try {
          await sbUpdateByUsername('posts', 'username', fromName.toLowerCase(), toName);
        } catch (e) {}
      }
      note('posts_stamp_rename', stamp);
    } catch (e) {
      note('posts_stamp_rename', { ok: false, status: 0, error: String(e && e.message || e) });
    }
  } else {
    note('posts_rename', await sbUpdateByUsername('posts', 'username', fromName, toName));
  }

  // Case-insensitive leftover posts under old handle
  try {
    var left = await sbRestIdentity(
      '/rest/v1/posts?username=ilike.' + encodeURIComponent(fromName) + '&select=id,username',
      { method: 'GET' }
    );
    if (left.ok && Array.isArray(left.data)) {
      for (var i = 0; i < left.data.length; i++) {
        var row = left.data[i];
        if (!row || normUser(row.username) === normUser(toName)) continue;
        var patch = { username: toName };
        if (userId) patch.user_id = userId;
        var up = await sbRestIdentity('/rest/v1/posts?id=eq.' + encodeURIComponent(String(row.id)), {
          method: 'PATCH',
          body: JSON.stringify(patch)
        });
        if (!up.ok && userId && /user_id/i.test(String(up.error || ''))) {
          up = await sbRestIdentity('/rest/v1/posts?id=eq.' + encodeURIComponent(String(row.id)), {
            method: 'PATCH',
            body: JSON.stringify({ username: toName })
          });
        }
        note('post_' + row.id, up);
      }
    }
  } catch (e) {}

  note('comments_username', await sbUpdateByUsername('comments', 'username', fromName, toName));
  try {
    await sbUpdateByUsername('comments', 'user', fromName, toName);
  } catch (e) {}
  note('user_saves', await sbUpdateByUsername('user_saves', 'username', fromName, toName));
  note('messages_from', await sbUpdateByUsername('messages', 'from_user', fromName, toName));
  note('messages_to', await sbUpdateByUsername('messages', 'to_user', fromName, toName));
  note('notifs_to', await sbUpdateByUsername('notifications', 'to_username', fromName, toName));
  note('notifs_from', await sbUpdateByUsername('notifications', 'from_username', fromName, toName));

  // Follows: rewrite endpoints (no bulk username column)
  try {
    var f1 = await sbRestIdentity(
      '/rest/v1/follows?follower=eq.' + encodeURIComponent(fromName) + '&select=follower,following',
      { method: 'GET' }
    );
    var rows1 = (f1.ok && Array.isArray(f1.data) ? f1.data : []) || [];
    for (var fi = 0; fi < rows1.length; fi++) {
      var fr = rows1[fi];
      await sbRestIdentity('/rest/v1/follows', {
        method: 'POST',
        headers: {
          apikey: SB_KEY,
          Authorization: 'Bearer ' + SB_KEY,
          'Content-Type': 'application/json',
          Prefer: 'resolution=merge-duplicates,return=minimal'
        },
        body: JSON.stringify({ follower: toName, following: fr.following })
      });
      await sbRestIdentity(
        '/rest/v1/follows?follower=eq.' +
          encodeURIComponent(fromName) +
          '&following=eq.' +
          encodeURIComponent(fr.following),
        { method: 'DELETE' }
      );
    }
    var f2 = await sbRestIdentity(
      '/rest/v1/follows?following=eq.' + encodeURIComponent(fromName) + '&select=follower,following',
      { method: 'GET' }
    );
    var rows2 = (f2.ok && Array.isArray(f2.data) ? f2.data : []) || [];
    for (var fj = 0; fj < rows2.length; fj++) {
      var fr2 = rows2[fj];
      await sbRestIdentity('/rest/v1/follows', {
        method: 'POST',
        headers: {
          apikey: SB_KEY,
          Authorization: 'Bearer ' + SB_KEY,
          'Content-Type': 'application/json',
          Prefer: 'resolution=merge-duplicates,return=minimal'
        },
        body: JSON.stringify({ follower: fr2.follower, following: toName })
      });
      await sbRestIdentity(
        '/rest/v1/follows?follower=eq.' +
          encodeURIComponent(fr2.follower) +
          '&following=eq.' +
          encodeURIComponent(fromName),
        { method: 'DELETE' }
      );
    }
    note('follows', { ok: true, status: 200, data: rows1.concat(rows2) });
  } catch (e) {
    note('follows', { ok: false, status: 0, error: String(e && e.message || e) });
  }

  // Profiles: rename in place by permanent user_id when possible, then free old handle.
  try {
    var renamedInPlace = false;
    if (userId && String(userId).indexOf('name:') !== 0) {
      var byUid = await sbRestIdentity(
        '/rest/v1/profiles?user_id=eq.' + encodeURIComponent(userId),
        {
          method: 'PATCH',
          body: JSON.stringify({
            username: toName,
            user_id: userId,
            updated_at: new Date().toISOString()
          })
        }
      );
      if (byUid.ok) {
        renamedInPlace = true;
        note('profile_rename_by_user_id', byUid);
      } else if (/user_id/i.test(String(byUid.error || ''))) {
        note('profile_rename_by_user_id', byUid);
      } else {
        note('profile_rename_by_user_id', byUid);
      }
    }
    if (!renamedInPlace) {
      var pup = await sbRestIdentity('/rest/v1/profiles?username=eq.' + encodeURIComponent(toName), {
        method: 'PATCH',
        body: JSON.stringify(
          userId
            ? { user_id: userId, updated_at: new Date().toISOString() }
            : { updated_at: new Date().toISOString() }
        )
      });
      if (!pup.ok && userId && /user_id/i.test(String(pup.error || ''))) {
        pup = await sbRestIdentity('/rest/v1/profiles?username=eq.' + encodeURIComponent(toName), {
          method: 'PATCH',
          body: JSON.stringify({ updated_at: new Date().toISOString() })
        });
      }
      note('profile_stamp', pup);
      // Fallback: rename the old row's username column in place
      if (normUser(fromName) !== normUser(toName)) {
        var ren = await sbRestIdentity('/rest/v1/profiles?username=eq.' + encodeURIComponent(fromName), {
          method: 'PATCH',
          body: JSON.stringify(
            userId
              ? { username: toName, user_id: userId, updated_at: new Date().toISOString() }
              : { username: toName, updated_at: new Date().toISOString() }
          )
        });
        note('profile_rename_old_row', ren);
      }
    }
    if (normUser(fromName) !== normUser(toName)) {
      // Delete orphan old-username rows that are NOT this account (frees the handle).
      var left = await sbRestIdentity(
        '/rest/v1/profiles?username=ilike.' +
          encodeURIComponent(fromName) +
          '&select=username,user_id&limit=10',
        { method: 'GET' }
      );
      if (left.ok && Array.isArray(left.data)) {
        for (var pi = 0; pi < left.data.length; pi++) {
          var prow = left.data[pi];
          if (!prow || !prow.username) continue;
          if (normUser(prow.username) === normUser(toName)) continue;
          if (userId && prow.user_id && String(prow.user_id) === String(userId)) continue;
          var delOne = await sbRestIdentity(
            '/rest/v1/profiles?username=eq.' + encodeURIComponent(prow.username),
            { method: 'DELETE' }
          );
          note('profile_delete_orphan_' + prow.username, delOne);
        }
      }
    }
  } catch (e) {
    note('profiles', { ok: false, status: 0, error: String(e && e.message || e) });
  }

  // Wallet keys still use username strings — migrate when possible
  try {
    note('coin_wallets', await sbUpdateByUsername('coin_wallets', 'user_id', fromName, toName));
  } catch (e) {}
  try {
    await cfFetch('/wallet/rename', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: SITE },
      body: JSON.stringify({ from: fromName, to: toName })
    });
  } catch (e) {}

  await recordUsernameAlias(fromName, toName, userId, fromName);
  await recordUsernameAlias(fromName.toLowerCase(), toName, userId, fromName);
  await recordUsernameAlias(toName, toName, userId, fromName);
  await recordUsernameAlias(toName.toLowerCase(), toName, userId, fromName);

  return report;
}

async function resolveUsernameIdentity(queryName) {
  var q = sanitizeUsername(queryName);
  var out = {
    ok: true,
    query: q,
    current_username: q,
    user_id: null,
    aliases: [],
    posts_count: 0
  };
  if (!q) return out;

  var aliasMap = await loadAliasBoardMap();
  var hit = aliasMap[normUser(q)];
  if (hit) {
    out.current_username = hit.current_username;
    out.user_id = hit.user_id || null;
  }

  try {
    var ar = await sbRestIdentity(
      '/rest/v1/username_aliases?or=(alias.ilike.' +
        encodeURIComponent(q) +
        ',current_username.ilike.' +
        encodeURIComponent(q) +
        ')&select=alias,user_id,current_username,previous_username&limit=40',
      { method: 'GET' }
    );
    if (ar.ok && Array.isArray(ar.data) && ar.data.length) {
      out.aliases = ar.data;
      out.current_username = ar.data[0].current_username || out.current_username;
      out.user_id = ar.data[0].user_id || out.user_id;
    }
  } catch (e) {}

  // Collect alias list from board for this account
  Object.keys(aliasMap).forEach(function (k) {
    var row = aliasMap[k];
    if (!row) return;
    if (normUser(row.current_username) === normUser(out.current_username) || (out.user_id && row.user_id === out.user_id)) {
      if (out.aliases.every(function (a) { return normUser(a.alias) !== normUser(row.alias); })) {
        out.aliases.push(row);
      }
    }
  });

  // Profile lookup (current display name)
  try {
    var pr = await sbRestIdentity(
      '/rest/v1/profiles?username=ilike.' + encodeURIComponent(out.current_username) + '&select=*&limit=1',
      { method: 'GET' }
    );
    if (pr.ok && Array.isArray(pr.data) && pr.data[0]) {
      out.profile = pr.data[0];
      out.current_username = pr.data[0].username || out.current_username;
      if (pr.data[0].user_id) out.user_id = pr.data[0].user_id;
    }
  } catch (e) {}

  // Count posts for current + aliases (username match; user_id when column exists)
  try {
    var names = [out.current_username]
      .concat(
        (out.aliases || []).map(function (a) {
          return a.alias || a.previous_username;
        })
      )
      .filter(Boolean);
    var uniq = [];
    names.forEach(function (n) {
      if (uniq.every(function (x) { return normUser(x) !== normUser(n); })) uniq.push(n);
    });
    var orParts = uniq.map(function (n) {
      return 'username.ilike.' + encodeURIComponent(n);
    });
    async function countWith(parts) {
      var list = await sbRestIdentity(
        '/rest/v1/posts?or=(' + parts.join(',') + ')&select=id&limit=200',
        { method: 'GET' }
      );
      if (list.ok && Array.isArray(list.data)) return list.data.length;
      return -1;
    }
    var nCount = await countWith(orParts);
    if (nCount < 0 && out.user_id) {
      // ignore
    } else if (nCount >= 0) {
      out.posts_count = nCount;
    }
    if (out.user_id) {
      var withUid = orParts.concat(['user_id.eq.' + encodeURIComponent(out.user_id)]);
      var n2 = await countWith(withUid);
      if (n2 >= 0) out.posts_count = n2;
    }
  } catch (e) {}

  return out;
}

async function handleUsernameIdentity(req, res, body, query) {
  body = body || {};
  query = query || {};
  var action = String(body.action || query.action || '').toLowerCase();

  if (action === 'resolve_username' || action === 'username_resolve') {
    var q = sanitizeUsername(body.username || body.user || query.username || query.user || '');
    var resolved = await resolveUsernameIdentity(q);
    return json(res, 200, resolved);
  }

  if (action === 'list_aliases' || action === 'username_aliases') {
    var map = await loadAliasBoardMap();
    return json(res, 200, { ok: true, aliases: Object.keys(map).map(function (k) { return map[k]; }) });
  }

  if (
    action === 'rename_username' ||
    action === 'sync_username' ||
    action === 'repair_username' ||
    action === 'username_rename'
  ) {
    var fromName = sanitizeUsername(body.from || body.old_username || body.old || '');
    var toName = sanitizeUsername(body.to || body.new_username || body.username || body.new || '');
    var userId = permanentAccountId(body);
    var authUser = await verifySupabaseBearer(req);
    var adminTok = bearerToken(req);
    var adminOk = false;
    try {
      adminOk = await verifyAdminToken(adminTok);
    } catch (e) {
      adminOk = false;
    }

    // Permanent admin purge (2026-11-24): UkPaki29 / UkPakiUmayr29 are closed —
    // do not auto-repair those handles. Explicit from/to still required.

    if (!fromName || !toName) {
      return json(res, 400, { ok: false, error: 'need_from_and_to' });
    }
    if (toName.length < 3) {
      return json(res, 400, { ok: false, error: 'username_too_short' });
    }

    // Authorize: admin, or Supabase session whose username/id matches the rename.
    var allowed = !!adminOk;
    if (!allowed && authUser) {
      if (!userId && authUser.id) userId = authUser.id;
      if (
        normUser(authUser.username) === normUser(fromName) ||
        normUser(authUser.username) === normUser(toName) ||
        (body.auth_user_id && String(body.auth_user_id) === String(authUser.id))
      ) {
        allowed = true;
      }
    }
    // Local/dev fallback: allow when caller proves anon permanent id already stamped on posts.
    if (!allowed && userId && String(userId).indexOf('anon_') === 0) {
      try {
        var probe = await sbRestIdentity(
          '/rest/v1/posts?tags=cs.{"anon_id:' +
            encodeURIComponent(userId.replace(/^anon_/, '')) +
            '"}&select=id&limit=1',
          { method: 'GET' }
        );
        if (probe.ok && Array.isArray(probe.data) && probe.data.length) allowed = true;
      } catch (e) {}
    }
    if (!allowed) {
      return json(res, 401, { ok: false, error: 'auth_required' });
    }

    if (!userId) userId = authUser && authUser.id ? authUser.id : 'name:' + normUser(toName);

    // Case-insensitive uniqueness after auth — blocks races on the same handle.
    if (normUser(fromName) !== normUser(toName)) {
      try {
        var takenProbe = await sbRestIdentity(
          '/rest/v1/profiles?username=ilike.' +
            encodeURIComponent(toName) +
            '&select=username,user_id&limit=5',
          { method: 'GET' }
        );
        if (takenProbe.ok && Array.isArray(takenProbe.data)) {
          for (var ti = 0; ti < takenProbe.data.length; ti++) {
            var trow = takenProbe.data[ti];
            if (!trow || !trow.username) continue;
            if (normUser(trow.username) !== normUser(toName)) continue;
            var sameAccount =
              (userId && trow.user_id && String(trow.user_id) === String(userId)) ||
              normUser(trow.username) === normUser(fromName);
            if (!sameAccount) {
              return json(res, 409, { ok: false, error: 'username_taken', username: trow.username });
            }
          }
        }
      } catch (eTaken) {}
      try {
        var aliasTaken = await sbRestIdentity(
          '/rest/v1/username_aliases?or=(alias.ilike.' +
            encodeURIComponent(toName) +
            ',current_username.ilike.' +
            encodeURIComponent(toName) +
            ')&select=alias,user_id,current_username&limit=10',
          { method: 'GET' }
        );
        if (aliasTaken.ok && Array.isArray(aliasTaken.data)) {
          for (var ai = 0; ai < aliasTaken.data.length; ai++) {
            var arow = aliasTaken.data[ai];
            if (!arow) continue;
            var pointsHere =
              normUser(arow.current_username) === normUser(fromName) ||
              (userId && arow.user_id && String(arow.user_id) === String(userId));
            if (pointsHere) continue;
            if (
              normUser(arow.alias) === normUser(toName) ||
              normUser(arow.current_username) === normUser(toName)
            ) {
              return json(res, 409, {
                ok: false,
                error: 'username_taken',
                username: arow.current_username || arow.alias
              });
            }
          }
        }
      } catch (eAlias) {}
    }

    var report = await migrateUsernameRecords(fromName, toName, userId);
    var after = await resolveUsernameIdentity(toName);
    return json(res, 200, {
      ok: true,
      renamed: true,
      from: fromName,
      to: toName,
      user_id: userId,
      report: report,
      identity: after
    });
  }

  return json(res, 400, { ok: false, error: 'unknown_identity_action' });
}

async function spendViaWallet(user, coins, action, ref) {
  // Allow stable anonymous wallets (anon_<id>) — block only bare guest/anon placeholders.
  var u = normUser(user);
  if (!u || u === 'anon' || u === 'guest') {
    return { ok: false, error: 'login_required_for_paid' };
  }
  if (isAnonUser(u)) {
    var aid = sanitizeAnonId(u.replace(/^anon[_:]/i, ''));
    if (!isValidAnonId(aid)) {
      return { ok: false, error: 'login_required_for_paid' };
    }
  }
  var led = await cfFetch('/wallet/ledger?user=' + encodeURIComponent(user));
  var rows = (led.json && led.json.ledger) || [];
  for (var i = 0; i < rows.length; i++) {
    var row = rows[i] || {};
    if (String(row.kind || '') === 'spend' && String(row.action || '') === action && String(row.ref_id || row.ref || '') === String(ref)) {
      return { ok: true, reused: true, balance: null, coins: coins };
    }
  }
  var res = await cfFetch('/wallet', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: SITE },
    body: JSON.stringify({ user: user, spend: coins, action: action, ref: ref })
  });
  if (res.json && res.json.ok) {
    return { ok: true, reused: false, balance: res.json.balance != null ? Number(res.json.balance) : null, coins: coins };
  }
  var err = String((res.json && (res.json.error || res.json.message)) || '');
  if (/insufficient|not enough|balance/i.test(err) || res.status === 402 || res.status === 400) {
    return { ok: false, error: 'insufficient', need: coins, balance: Number((res.json && res.json.balance) || 0) || 0 };
  }
  return { ok: false, error: err || 'spend_failed' };
}

function bearerToken(req) {
  var h = String((req.headers && (req.headers.authorization || req.headers.Authorization)) || '');
  var m = h.match(/^Bearer\s+(.+)$/i);
  return m ? String(m[1] || '').trim() : '';
}

async function verifyAdminToken(token) {
  if (!token) return false;
  var res = await cfFetch('/admin/requests?limit=1', {
    headers: { Authorization: 'Bearer ' + token, Origin: SITE }
  });
  return !!(res.ok && res.json && res.json.ok !== false);
}

/** Idempotent pack credit — returns { granted, reused, pack_spins }. Supports roulette/dice/tic_tac_toe. */
async function grantGamePack(user, game, playId, meta) {
  meta = meta || {};
  game = normalizeGame(game) || 'roulette';
  var uses = Number(meta.spins || meta.uses || GAME_PACK_USES) || GAME_PACK_USES;
  var packs = await fetchBoard(BOARD_PACKS);
  for (var i = 0; i < packs.length; i++) {
    var msg = parseMsg(packs[i] && packs[i].message);
    if (!msg) continue;
    if (normUser(msg.user || packs[i].from_username) !== normUser(user)) continue;
    if (msg.kind !== 'pack_purchase') continue;
    if (normalizeGame(msg.game || 'roulette') !== game) continue;
    var pid = String(msg.play_id || msg.request_id || packs[i].post_id || '');
    if (pid && (pid === String(playId) || pid === String(meta.request_id || ''))) {
      return {
        ok: true,
        reused: true,
        spins_granted: 0,
        pack_spins: gamePackBalance(packs, user, game)
      };
    }
  }
  var boardKind = packActionForGame(game);
  await postBoard(BOARD_PACKS, user, boardKind, playId, {
    user: user,
    game: game,
    kind: 'pack_purchase',
    spins: uses,
    uses: uses,
    coins: Number(meta.coins || 0) || 0,
    play_id: playId,
    request_id: meta.request_id || playId,
    source: meta.source || 'purchase',
    provider: meta.provider || '',
    at: Date.now(),
    usd: meta.usd != null ? meta.usd : 1,
    account_type: isAnonUser(user) ? 'anonymous' : 'registered'
  });
  await postBoard(BOARD_PLAYS, user, boardKind, playId, {
    id: playId,
    user: user,
    game: game,
    kind: 'pack_purchase',
    spins: uses,
    uses: uses,
    coins: Number(meta.coins || 0) || 0,
    source: meta.source || 'purchase',
    at: Date.now()
  });
  var after = await fetchBoard(BOARD_PACKS);
  return {
    ok: true,
    reused: false,
    spins_granted: uses,
    pack_spins: gamePackBalance(after, user, game)
  };
}

/** Backward-compatible alias used by admin grant_pack paths. */
async function grantRoulettePack(user, playId, meta) {
  return grantGamePack(user, 'roulette', playId, meta);
}

/** Collect unique free-use timestamps for a user+game (legacy daily board merged). */
function collectFreeUseTimes(notifs, user, game) {
  var times = [];
  var seen = {};
  for (var i = 0; i < notifs.length; i++) {
    var msg = parseMsg(notifs[i] && notifs[i].message);
    if (!msg) continue;
    if (normUser(msg.user || notifs[i].from_username) !== user) continue;
    if (normalizeGame(msg.game) !== game) continue;
    if (msg.paid) continue;
    var pid = String(msg.play_id || msg.id || notifs[i].id || i);
    if (seen[pid]) continue;
    seen[pid] = 1;
    var at = Number(msg.at) || Date.parse(String(notifs[i].created_at || '')) || 0;
    times.push(at || 0);
  }
  times.sort(function (a, b) { return a - b; });
  return times;
}

/**
 * 3 free uses per cycle → 24h recovery → restore 3.
 * Uses after recoveryEnds start a new cycle. Independent per game.
 */
function freeCycleState(notifs, user, game, now) {
  now = now || Date.now();
  var times = collectFreeUseTimes(notifs, user, game);
  var cycleUsed = 0;
  var recoveryEnds = 0;
  for (var i = 0; i < times.length; i++) {
    var t = times[i];
    if (recoveryEnds && t < recoveryEnds) continue;
    if (recoveryEnds && t >= recoveryEnds) {
      recoveryEnds = 0;
      cycleUsed = 0;
    }
    cycleUsed++;
    if (cycleUsed >= FREE_USES_PER_GAME) {
      recoveryEnds = t + FREE_RECOVERY_MS;
    }
  }
  if (recoveryEnds && now < recoveryEnds) {
    return {
      free_used: FREE_USES_PER_GAME,
      free_left: 0,
      recovery_ends_at: recoveryEnds,
      recovery_ms: Math.max(0, recoveryEnds - now),
      cycle_used: FREE_USES_PER_GAME
    };
  }
  if (recoveryEnds && now >= recoveryEnds) {
    return {
      free_used: 0,
      free_left: FREE_USES_PER_GAME,
      recovery_ends_at: 0,
      recovery_ms: 0,
      cycle_used: 0
    };
  }
  return {
    free_used: cycleUsed,
    free_left: Math.max(0, FREE_USES_PER_GAME - cycleUsed),
    recovery_ends_at: 0,
    recovery_ms: 0,
    cycle_used: cycleUsed
  };
}

/** Lifetime-style count of free rows (debug / tests). Prefer freeCycleState. */
function countFreeUses(notifs, user, game) {
  return collectFreeUseTimes(notifs, user, game).length;
}

function gamePackBalance(notifs, user, game) {
  game = normalizeGame(game) || 'roulette';
  var granted = 0;
  var used = 0;
  var defaultUses = GAME_PACK_USES || ROULETTE_PACK_SPINS || 10;
  for (var i = 0; i < notifs.length; i++) {
    var msg = parseMsg(notifs[i] && notifs[i].message);
    if (!msg) continue;
    if (normUser(msg.user || notifs[i].from_username) !== user) continue;
    if (normalizeGame(msg.game || '') !== game) continue;
    if (msg.kind === 'pack_purchase') granted += Number(msg.spins || msg.uses || defaultUses) || 0;
    if (msg.kind === 'pack_spin' || msg.kind === 'pack_use') used += 1;
  }
  return Math.max(0, granted - used);
}

function roulettePackBalance(notifs, user) {
  return gamePackBalance(notifs, user, 'roulette');
}

async function patchFeatured(postId, until, meta) {
  var body = { featured_until: until || 0 };
  if (meta && meta.source) body.pin_source = meta.source;
  var res = await cfFetch('/posts/' + encodeURIComponent(String(postId)), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Origin: SITE },
    body: JSON.stringify(body)
  });
  return res;
}

async function loadFreeBoards() {
  var a = await fetchBoard(BOARD_FREE);
  var b = await fetchBoard(BOARD_FREE_LEGACY);
  return (a || []).concat(b || []);
}

function freeSnapshot(freeBoard, user, now) {
  now = now || Date.now();
  var r = freeCycleState(freeBoard, user, 'roulette', now);
  var d = freeCycleState(freeBoard, user, 'dice', now);
  var t = freeCycleState(freeBoard, user, 'tic_tac_toe', now);
  return {
    free_used: { roulette: r.free_used, dice: d.free_used, tic_tac_toe: t.free_used },
    free_left: { roulette: r.free_left, dice: d.free_left, tic_tac_toe: t.free_left },
    recovery_ends_at: {
      roulette: r.recovery_ends_at || 0,
      dice: d.recovery_ends_at || 0,
      tic_tac_toe: t.recovery_ends_at || 0
    },
    recovery_ms: {
      roulette: r.recovery_ms || 0,
      dice: d.recovery_ms || 0,
      tic_tac_toe: t.recovery_ms || 0
    },
    free_per_game: FREE_USES_PER_GAME,
    free_recovery_ms: FREE_RECOVERY_MS
  };
}

async function recordFreeUse(user, game, playId) {
  await postBoard(BOARD_FREE, user, 'free_play', playId, {
    user: user,
    game: game,
    day: dayKey(),
    play_id: playId,
    at: Date.now(),
    paid: false,
    cycle: true
  });
}

async function patchPostExpires(postId, expiresAtMs, meta) {
  var body = { expires_at: expiresAtMs || 0 };
  if (meta && meta.source) body.extend_source = meta.source;
  if (meta && meta.add_ms) body.extend_ms = meta.add_ms;
  var res = await cfFetch('/posts/' + encodeURIComponent(String(postId)), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Origin: SITE },
    body: JSON.stringify(body)
  });
  return res;
}

async function grantPinReward(user, postId, source, hours, extra) {
  extra = extra || {};
  var featuredUntil = Date.now() + (Number(hours) || 48) * 60 * 60 * 1000;
  var pinRes = await patchFeatured(postId, featuredUntil, { source: source });
  var pinGranted = !!(pinRes.json && (pinRes.json.ok !== false) && pinRes.ok);
  var reward = {
    user: user,
    post_id: postId,
    source: source,
    until: featuredUntil,
    at: Date.now(),
    granted: pinGranted,
    hours: hours,
    label: '🏆 Fijada ganada en la ruleta',
    badge: source === 'roulette' ? 'roulette_won' : source
  };
  Object.keys(extra).forEach(function (k) { reward[k] = extra[k]; });
  await postBoard(BOARD_PIN_REWARDS, user, source + '_pin_reward', postId, reward);
  await postBoard('__PIN_BOARD__', user, 'pin', postId, {
    id: String(postId),
    until: featuredUntil,
    user: user,
    source: source,
    rouletteWon: source === 'roulette',
    badge: source === 'roulette' ? 'roulette_won' : '',
    label: source === 'roulette' ? '🏆 Fijada ganada en la ruleta' : '',
    at: Date.now()
  });
  await postBoard('admin', user, source + '_pin_reward', postId, {
    message: String(source).toUpperCase() + ' PIN REWARD · @' + user + ' · post #' + postId + ' · until ' + new Date(featuredUntil).toISOString()
  });
  return { pinGranted: pinGranted, featuredUntil: featuredUntil, reward: reward };
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return json(res, 204, {});

  if (req.method === 'GET') {
    var qAction = String((req.query && req.query.action) || '').toLowerCase();
    if (qAction === 'anon_identity' || qAction === 'anon' || qAction === 'identity') {
      return handleAnonIdentity(req, res, null, req.query || {});
    }
    if (
      qAction === 'list_anon_subs' ||
      qAction === 'anon_subs' ||
      qAction === 'ensure_anon_subs'
    ) {
      return handleAnonSubs(req, res, null, req.query || {});
    }
    if (
      qAction === 'resolve_username' ||
      qAction === 'username_resolve' ||
      qAction === 'list_aliases' ||
      qAction === 'username_aliases'
    ) {
      return handleUsernameIdentity(req, res, null, req.query || {});
    }
    var player = resolvePlayer(null, req.query || {}, req);
    var qGame = normalizeGame((req.query && req.query.game) || '');
    try {
      var plays = await fetchBoard(BOARD_PLAYS);
      var free = await loadFreeBoards();
      var packs = await fetchBoard(BOARD_PACKS);
      var out = {
        ok: true,
        costs: {
          roulette: FC_ROULETTE,
          dice: FC_DICE,
          roulette_pack: FC_ROULETTE_PACK,
          dice_pack: FC_DICE_PACK,
          tic_tac_toe_pack: FC_TTT_PACK,
          pin: 10,
          delete: 10,
          print: 350
        },
        custom_games_enabled: false,
        packs: [
          { usd: 5, coins: 60 },
          { usd: 10, coins: 110 },
          { usd: 25, coins: 300 },
          { usd: 50, coins: 600 },
          { usd: 99, coins: 1200 }
        ],
        free_per_game: FREE_USES_PER_GAME,
        free_per_day: FREE_USES_PER_GAME, // legacy alias — 3 per recovery cycle
        free_recovery_ms: FREE_RECOVERY_MS,
        roulette_pack_spins: ROULETTE_PACK_SPINS,
        game_pack_uses: GAME_PACK_USES,
        live_games: ['roulette', 'dice', 'tic_tac_toe'],
        triki_max_games: 3,
        triki_wins_for_pin: 3,
        triki_pin_hours: TRIKI_PIN_HOURS,
        roulette_pin_hours: ROULETTE_PIN_HOURS,
        extend_10d_ms: EXTEND_10D_MS
      };
      if (player.user) {
        Object.assign(out, freeSnapshot(free, player.user));
        out.anon = !!player.anon;
        out.account_type = player.anon ? 'anonymous' : 'registered';
        out.anonymous_user_id = player.anonId || null;
        out.pack_spins = roulettePackBalance(packs, player.user);
        out.pack_spins_map = {
          roulette: gamePackBalance(packs, player.user, 'roulette'),
          dice: gamePackBalance(packs, player.user, 'dice'),
          tic_tac_toe: gamePackBalance(packs, player.user, 'tic_tac_toe')
        };
        out.plays = plays
          .map(function (n) { return parseMsg(n.message); })
          .filter(function (m) {
            if (!m) return false;
            if (normUser(m.user) !== player.user) return false;
            if (qGame && normalizeGame(m.game) !== qGame) return false;
            return true;
          })
          .slice(0, 40);
      }
      return json(res, 200, out);
    } catch (e) {
      return json(res, 500, { ok: false, error: (e && e.message) || 'server_error' });
    }
  }

  if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'method_not_allowed' });

  var body;
  try {
    body = await readBody(req);
  } catch (e) {
    return json(res, 400, { ok: false, error: 'invalid_json' });
  }

  var player = resolvePlayer(body, null, req);
  var user = player.user;
  var game = normalizeGame(body.game || body.kind || '');
  var playId = String(body.play_id || body.ref || body.idempotency_key || '').trim().slice(0, 80);
  var result = body.result || null;
  var paid = !!body.paid;
  var forcePaid = !!body.force_paid;
  var options = Array.isArray(body.options) ? body.options.slice(0, 30) : null;
  var postId = String(body.post_id || body.postId || '').trim();
  var sessionId = String(body.session_id || body.sessionId || '').trim().slice(0, 80);
  var wins = Number(body.wins || 0) || 0;
  var gamesPlayed = Number(body.games || body.games_played || 0) || 0;
  var action = String(body.action || '').toLowerCase();
  if (action === 'anon_identity' || action === 'link_anon') {
    return handleAnonIdentity(req, res, body, null);
  }
  if (
    action === 'list_anon_subs' ||
    action === 'anon_subs' ||
    action === 'ensure_anon_subs'
  ) {
    return handleAnonSubs(req, res, body, null);
  }
  if (
    action === 'rename_username' ||
    action === 'sync_username' ||
    action === 'repair_username' ||
    action === 'username_rename' ||
    action === 'resolve_username' ||
    action === 'username_resolve' ||
    action === 'list_aliases' ||
    action === 'username_aliases'
  ) {
    return handleUsernameIdentity(req, res, body, null);
  }

  // Admin grant / reject of external game pack payments (PayPal / Throne / BTC).
  // Supports roulette, dice, and tic_tac_toe — 10 plays credited immediately on approve.
  if (action === 'grant_pack' || action === 'approve_pack' || action === 'reject_pack') {
    var adminTok = bearerToken(req);
    var adminOk = false;
    try { adminOk = await verifyAdminToken(adminTok); } catch (e) { adminOk = false; }
    if (!adminOk) return json(res, 401, { ok: false, error: 'admin_required' });
    var target = normUser(body.target_user || body.user || body.username || '');
    if (!target) return json(res, 400, { ok: false, error: 'need_user' });
    var reqId = String(body.request_id || body.play_id || body.ref || playId || '').trim().slice(0, 80);
    if (!reqId) reqId = 'admin_pack_' + Date.now().toString(36);
    var grantGame = normalizeGame(body.game || body.pack_game || game || 'roulette') || 'roulette';
    if (grantGame === 'triki') grantGame = 'tic_tac_toe';
    if (!LIVE_GAMES[grantGame]) grantGame = 'roulette';
    var unitLabel = grantGame === 'dice' ? 'rolls' : (grantGame === 'tic_tac_toe' ? 'games' : 'spins');
    if (action === 'reject_pack') {
      await postBoard(BOARD_PLAYS, target, packActionForGame(grantGame) + '_reject', reqId, {
        user: target, game: grantGame, kind: 'pack_reject',
        request_id: reqId, at: Date.now(), reason: String(body.reason || 'rejected')
      });
      try {
        await postBoard(target, 'admin', grantGame + '_pack_rejected', reqId, {
          user: target, game: grantGame, request_id: reqId, status: 'rejected', at: Date.now(),
          message: String(grantGame).toUpperCase() + ' pack payment rejected — no ' + unitLabel + ' credited.'
        });
      } catch (e) {}
      return json(res, 200, { ok: true, status: 'rejected', request_id: reqId, user: target, game: grantGame });
    }
    var granted = await grantGamePack(target, grantGame, reqId, {
      source: 'admin_approve',
      provider: String(body.provider || 'external'),
      request_id: reqId,
      coins: 0,
      usd: 5,
      spins: GAME_PACK_USES
    });
    try {
      await postBoard(target, 'admin', grantGame + '_unlock', reqId, {
        user: target, game: grantGame, request_id: reqId, status: 'approved',
        spins: GAME_PACK_USES, at: Date.now(),
        message: 'Payment verified — ' + GAME_PACK_USES + ' ' + grantGame + ' ' + unitLabel + ' unlocked.'
      });
    } catch (e) {}
    return json(res, 200, {
      ok: true,
      status: 'approved',
      reused: !!granted.reused,
      user: target,
      game: grantGame,
      request_id: reqId,
      spins_granted: granted.spins_granted,
      pack_spins: granted.pack_spins,
      account_type: isAnonUser(target) ? 'anonymous' : 'registered'
    });
  }

  if (!user) {
    return json(res, 401, { ok: false, error: 'session_required', message: 'Missing anonymous session or login' });
  }
  if (game && !LIVE_GAMES[game]) {
    if (game === 'custom_roulette' || game === 'custom_dice') {
      return json(res, 410, {
        ok: false,
        error: 'custom_removed',
        message: 'Custom 30 options purchases have been removed. Buy 10 plays for 10 Coins instead.'
      });
    }
    return json(res, 400, { ok: false, error: 'game_disabled', game: game });
  }
  if (!playId) {
    playId = game + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  }

  var lockKey = user + '|' + game + '|' + playId;
  if (locks.get(lockKey)) return json(res, 409, { ok: false, error: 'in_progress' });
  if (recent.get(lockKey) && Date.now() - recent.get(lockKey).at < 8 * 60 * 1000) {
    return json(res, 200, Object.assign({ ok: true, reused: true }, recent.get(lockKey).body || {}));
  }
  locks.set(lockKey, Date.now());

  try {
    // Custom 30-option purchases permanently removed (CUSTOM_GAMES_ENABLED=false).
    if (!CUSTOM_GAMES_ENABLED && (game === 'custom_roulette' || game === 'custom_dice')) {
      return json(res, 410, {
        ok: false,
        error: 'custom_removed',
        message: 'Custom 30 options purchases have been removed.'
      });
    }

    // —— Game packs: 10 Coins → 10 prepaid uses (roulette / dice / tic_tac_toe) ——
    if (
      (game === 'roulette' || game === 'dice' || game === 'tic_tac_toe') &&
      (action === 'buy_pack' || action === 'roulette_pack' || action === 'dice_pack' || action === 'tic_tac_toe_pack' || action === 'triki_pack')
    ) {
      var packGame = game === 'tic_tac_toe' ? 'tic_tac_toe' : game;
      if (action === 'dice_pack') packGame = 'dice';
      if (action === 'tic_tac_toe_pack' || action === 'triki_pack') packGame = 'tic_tac_toe';
      if (action === 'roulette_pack') packGame = 'roulette';
      var packCost = packCostForGame(packGame);
      var packSpendAction = packActionForGame(packGame);
      var packSpend = await spendViaWallet(user, packCost, packSpendAction, playId);
      if (!packSpend.ok) {
        if (packSpend.error === 'insufficient') {
          return json(res, 402, {
            ok: false,
            error: 'insufficient',
            message: 'Insufficient Coins',
            need: packCost,
            balance: packSpend.balance || 0
          });
        }
        if (packSpend.error === 'login_required_for_paid') {
          return json(res, 401, { ok: false, error: 'session_required', message: 'Anonymous identity required' });
        }
        return json(res, 502, { ok: false, error: packSpend.error || 'spend_failed', need: packCost });
      }
      var grantedPack = { ok: true, reused: true, spins_granted: 0, pack_spins: 0 };
      if (!packSpend.reused) {
        grantedPack = await grantGamePack(user, packGame, playId, {
          source: 'fc',
          provider: 'fc',
          coins: packCost,
          usd: 1,
          spins: GAME_PACK_USES,
          request_id: playId
        });
      } else {
        grantedPack.pack_spins = gamePackBalance(await fetchBoard(BOARD_PACKS), user, packGame);
      }
      var outPack = {
        ok: true,
        reused: !!packSpend.reused || !!grantedPack.reused,
        game: packGame,
        action: 'buy_pack',
        play_id: playId,
        coins: packCost,
        spins_granted: packSpend.reused ? 0 : (grantedPack.spins_granted || GAME_PACK_USES),
        pack_spins: grantedPack.pack_spins,
        balance: packSpend.balance,
        anon: !!player.anon,
        account_type: player.anon ? 'anonymous' : 'registered',
        anonymous_user_id: player.anonId || null,
        label: packSpend.reused
          ? 'Already credited'
          : ('-' + packCost + ' Coins — ' + GAME_PACK_USES + ' ' + packGame + ' uses')
      };
      recent.set(lockKey, { at: Date.now(), body: outPack });
      return json(res, 200, outPack);
    }

    // —— Roulette pin claim (registered only; linked to reward record) ——
    if (game === 'roulette' && (action === 'claim_pin' || action === 'pin_reward' || body.pin === true || body.pin_reward === true)) {
      if (player.anon) {
        return json(res, 403, { ok: false, error: 'anon_no_rewards', message: 'Anonymous players cannot receive pin rewards' });
      }
      if (!postId) return json(res, 400, { ok: false, error: 'need_post_id' });
      // Idempotent: reuse existing reward for this post+user
      var existingRewards = await fetchBoard(BOARD_PIN_REWARDS);
      for (var ri = 0; ri < existingRewards.length; ri++) {
        var em = parseMsg(existingRewards[ri] && existingRewards[ri].message);
        if (!em) continue;
        if (normUser(em.user || existingRewards[ri].from_username) !== user) continue;
        if (String(em.post_id || existingRewards[ri].post_id) !== String(postId)) continue;
        if (String(em.source || '') === 'roulette' || String(existingRewards[ri].type || '').indexOf('roulette') >= 0) {
          var reusedOut = {
            ok: true,
            reused: true,
            game: 'roulette',
            play_id: playId,
            pin_granted: !!em.granted || true,
            featured_until: em.until || null,
            source: 'roulette',
            badge: 'roulette_won',
            label: '🏆 Fijada ganada en la ruleta'
          };
          recent.set(lockKey, { at: Date.now(), body: reusedOut });
          return json(res, 200, reusedOut);
        }
      }
      var granted = await grantPinReward(user, postId, 'roulette', ROULETTE_PIN_HOURS, {
        play_id: playId,
        result: result
      });
      await postBoard(BOARD_PLAYS, user, 'roulette_pin', playId, {
        id: playId, user: user, game: 'roulette', kind: 'pin_reward',
        post_id: postId, at: Date.now(), until: granted.featuredUntil
      });
      var outPin = {
        ok: true,
        game: 'roulette',
        play_id: playId,
        pin_granted: granted.pinGranted,
        featured_until: granted.featuredUntil,
        source: 'roulette',
        badge: 'roulette_won',
        label: '🏆 Fijada ganada en la ruleta'
      };
      recent.set(lockKey, { at: Date.now(), body: outPin });
      return json(res, 200, outPin);
    }

    // —— Claim +10 days extend reward (registered only) ——
    if ((game === 'roulette' || game === 'dice' || game === 'tic_tac_toe') && (action === 'claim_extend' || action === 'extend_10d')) {
      if (player.anon) {
        return json(res, 403, { ok: false, error: 'anon_no_rewards', message: 'Anonymous players cannot receive extend rewards' });
      }
      if (!postId) return json(res, 400, { ok: false, error: 'need_post_id' });
      var existingExt = await fetchBoard(BOARD_EXTEND_REWARDS);
      for (var ei = 0; ei < existingExt.length; ei++) {
        var exm = parseMsg(existingExt[ei] && existingExt[ei].message);
        if (!exm) continue;
        if (normUser(exm.user || existingExt[ei].from_username) !== user) continue;
        if (String(exm.post_id || '') !== String(postId)) continue;
        if (String(exm.play_id || '') === String(playId) || String(exm.source_play || '') === String(playId)) {
          var reusedExt = {
            ok: true, reused: true, game: game, play_id: playId,
            post_id: postId, expires_at: exm.expires_at || null,
            extended_ms: EXTEND_10D_MS, label: 'Extended +10 days (already claimed)'
          };
          recent.set(lockKey, { at: Date.now(), body: reusedExt });
          return json(res, 200, reusedExt);
        }
      }
      var postRes = await cfFetch('/posts/' + encodeURIComponent(String(postId)), { cache: 'no-store' });
      var postObj = (postRes.json && (postRes.json.post || postRes.json.data || postRes.json)) || {};
      var curExp = Number(postObj.expires_at || postObj.expires || 0) || 0;
      if (curExp > 0 && curExp < 1e12) curExp = curExp * 1000; // seconds → ms
      if (!curExp || curExp < Date.now()) curExp = Date.now();
      var newExp = curExp + EXTEND_10D_MS;
      var patchExt = await patchPostExpires(postId, newExp, { source: game + '_win', add_ms: EXTEND_10D_MS });
      var extOk = !!(patchExt.ok && patchExt.json && patchExt.json.ok !== false);
      await postBoard(BOARD_EXTEND_REWARDS, user, 'extend_10d', playId, {
        user: user, game: game, post_id: postId, play_id: playId,
        source_play: playId, expires_at: newExp, add_ms: EXTEND_10D_MS,
        granted: extOk, at: Date.now()
      });
      await postBoard(BOARD_PLAYS, user, game + '_extend', playId, {
        id: playId, user: user, game: game, kind: 'extend_10d',
        post_id: postId, expires_at: newExp, at: Date.now()
      });
      var outExt = {
        ok: true, game: game, play_id: playId, post_id: postId,
        expires_at: newExp, extended_ms: EXTEND_10D_MS, granted: extOk,
        label: '+10 days applied to post #' + postId
      };
      recent.set(lockKey, { at: Date.now(), body: outExt });
      return json(res, 200, outExt);
    }

    // —— Roulette / Dice spin ——
    if (game === 'roulette' || game === 'dice') {
      var freeBoard = await loadFreeBoards();
      var snap = freeSnapshot(freeBoard, user);
      var freeLeftNow = snap.free_left[game] || 0;
      var recoveryEndsNow = (snap.recovery_ends_at && snap.recovery_ends_at[game]) || 0;
      var packBoard = await fetchBoard(BOARD_PACKS);
      var packLeft = gamePackBalance(packBoard, user, game);
      var useFree = !forcePaid && freeLeftNow > 0;
      var usePack = !useFree && packLeft > 0;
      var packNeed = packCostForGame(game);
      var balance = null;
      var reused = false;
      var coinsCharged = 0;

      if (useFree) {
        paid = false;
        await recordFreeUse(user, game, playId);
      } else if (usePack) {
        paid = true;
        coinsCharged = 0;
        await postBoard(BOARD_PACKS, user, packActionForGame(game) + '_spin', playId, {
          user: user, game: game, kind: 'pack_spin', play_id: playId, at: Date.now(),
          account_type: player.anon ? 'anonymous' : 'registered'
        });
      } else {
        // Prefer buying a 10-use pack (10 Coins) — no per-play charges for roulette/dice.
        return json(res, 402, {
          ok: false,
          error: 'free_exhausted',
          message: 'Free uses exhausted. Get 10 additional uses for ' + packNeed + ' Coins.',
          free_left: 0,
          recovery_ends_at: recoveryEndsNow || null,
          recovery_ms: recoveryEndsNow ? Math.max(0, recoveryEndsNow - Date.now()) : 0,
          pack_spins: packLeft,
          need: packNeed,
          pack_available: true,
          anon: !!player.anon
        });
      }

      // Server-authoritative outcome (client animates to these indices)
      var resultIdx = null;
      var diceRoll = null;
      if (game === 'roulette') {
        var optionCount = Number(body.option_count || body.options_count || 30) || 30;
        optionCount = Math.max(2, Math.min(60, Math.floor(optionCount)));
        if (result && result.idx != null && Number(result.idx) >= 0 && Number(result.idx) < optionCount) {
          // Ignore client-suggested idx — always server pick
        }
        resultIdx = pickWeightedRouletteIdx(optionCount, body.prize_indices || body.prizeIndices || []);
      } else if (game === 'dice') {
        diceRoll = pickCoherentDiceRoll();
      }

      var pinPrize = !!(body.pin_prize || (result && result.pin) || (result && result.pin_prize));
      var playPayload = {
        id: playId,
        user: user,
        game: game,
        paid: paid,
        free: !!useFree,
        pack: !!usePack,
        coins: coinsCharged,
        result: result || null,
        result_idx: resultIdx,
        dice: diceRoll,
        pin_prize: pinPrize,
        anon: !!player.anon,
        at: Date.now()
      };
      await postBoard(BOARD_PLAYS, user, game + '_play', playId, playPayload);

      var packsLeftAfter = gamePackBalance(await fetchBoard(BOARD_PACKS), user, game);
      var snapAfter = useFree ? freeSnapshot(await loadFreeBoards(), user) : snap;
      var freeLeftAfter = snapAfter.free_left[game] != null ? snapAfter.free_left[game] : (useFree ? Math.max(0, freeLeftNow - 1) : freeLeftNow);
      var recoveryAfter = (snapAfter.recovery_ends_at && snapAfter.recovery_ends_at[game]) || 0;
      var outSpin = {
        ok: true,
        reused: reused,
        game: game,
        play_id: playId,
        paid: paid,
        free: !!useFree,
        pack: !!usePack,
        coins: coinsCharged,
        balance: balance,
        free_left: freeLeftAfter,
        free_left_map: Object.assign({}, snapAfter.free_left),
        recovery_ends_at: recoveryAfter || 0,
        recovery_ms: recoveryAfter ? Math.max(0, recoveryAfter - Date.now()) : 0,
        recovery_ends_at_map: Object.assign({}, snapAfter.recovery_ends_at || {}),
        pack_spins: packsLeftAfter,
        anon: !!player.anon,
        xp_eligible: !player.anon,
        pin_prize: pinPrize,
        result_idx: resultIdx,
        dice: diceRoll,
        label: useFree
          ? ('Free ' + game + ' · ' + freeLeftAfter + ' free left')
          : (usePack
            ? ('Pack spin · ' + packsLeftAfter + ' left')
            : ('-' + coinsCharged + ' Coins — ' + game))
      };
      recent.set(lockKey, { at: Date.now(), body: outSpin });
      return json(res, 200, outSpin);
    }

    // —— Tic-Tac-Toe / Triki ——
    if (game === 'tic_tac_toe') {
      action = action || 'play';
      if (!sessionId) sessionId = 'ttt_' + user + '_' + dayKey();

      if (action === 'consume_free' || action === 'start' || action === 'play' || action === 'result') {
        var freeBoardT = await loadFreeBoards();
        var snapT = freeSnapshot(freeBoardT, user);
        var freeLeftT = snapT.free_left.tic_tac_toe;
        var packBoardT = await fetchBoard(BOARD_PACKS);
        var packLeftT = gamePackBalance(packBoardT, user, 'tic_tac_toe');
        var consumeFree = action === 'consume_free' || action === 'start' || (action === 'play' && !body.skip_free);
        var usePackT = false;

        // First play of a challenge session consumes one free use (unless paid / already counted)
        var usedThisPlay = false;
        if (consumeFree && !forcePaid && !body.paid) {
          if (freeLeftT <= 0 && packLeftT <= 0 && action !== 'result') {
            var recT = (snapT.recovery_ends_at && snapT.recovery_ends_at.tic_tac_toe) || 0;
            return json(res, 402, {
              ok: false,
              error: 'free_exhausted',
              message: 'Free Tic-Tac-Toe uses exhausted. Get 10 games for ' + FC_TTT_PACK + ' Coins.',
              free_left: 0,
              free_left_map: snapT.free_left,
              recovery_ends_at: recT || null,
              recovery_ms: recT ? Math.max(0, recT - Date.now()) : 0,
              recovery_ends_at_map: snapT.recovery_ends_at || {},
              pack_spins: packLeftT,
              need: FC_TTT_PACK,
              pack_available: true
            });
          }
          if (action === 'consume_free' || action === 'start' || (action === 'play' && gamesPlayed <= 1)) {
            // Deduplicate by session: only one free/pack charge per challenge session
            var alreadySession = false;
            for (var fi = 0; fi < freeBoardT.length; fi++) {
              var fm = parseMsg(freeBoardT[fi] && freeBoardT[fi].message);
              if (!fm) continue;
              if (normUser(fm.user || freeBoardT[fi].from_username) !== user) continue;
              if (normalizeGame(fm.game) !== 'tic_tac_toe') continue;
              if (String(fm.session_id || '') === sessionId) { alreadySession = true; break; }
            }
            if (!alreadySession && freeLeftT > 0) {
              await postBoard(BOARD_FREE, user, 'free_play', playId, {
                user: user, game: 'tic_tac_toe', day: dayKey(), play_id: playId,
                session_id: sessionId, at: Date.now(), paid: false, cycle: true
              });
              usedThisPlay = true;
              var snapT2 = freeSnapshot(await loadFreeBoards(), user);
              freeLeftT = snapT2.free_left.tic_tac_toe;
              snapT = snapT2;
            } else if (freeLeftT <= 0 && packLeftT > 0 && (action === 'consume_free' || action === 'start' || body.consume_pack)) {
              // Pack grants individual games (partidas), not whole sessions.
              usePackT = true;
              await postBoard(BOARD_PACKS, user, 'tic_tac_toe_pack_spin', playId, {
                user: user, game: 'tic_tac_toe', kind: 'pack_spin', play_id: playId,
                session_id: sessionId, at: Date.now(),
                account_type: player.anon ? 'anonymous' : 'registered'
              });
              packLeftT = Math.max(0, packLeftT - 1);
            }
          }
        }

        if (gamesPlayed > 3) {
          return json(res, 400, { ok: false, error: 'max_games', message: 'Max 3 games per challenge session', max: 3 });
        }

        await postBoard(BOARD_PLAYS, user, 'triki_play', playId, {
          id: playId, user: user, game: 'tic_tac_toe', session_id: sessionId,
          result: result, wins: wins, games: gamesPlayed, anon: !!player.anon, at: Date.now()
        });
        await postBoard(BOARD_TRIKI, user, 'triki_session', sessionId, {
          user: user, session_id: sessionId, wins: wins, games: gamesPlayed,
          result: result, play_id: playId, at: Date.now()
        });

        var pinGranted = false;
        var featuredUntil = 0;
        var pinLabel = '';
        // Triki pin reward kept for history; roulette-won badge is roulette-only.
        if (!player.anon && wins >= 3 && postId && (action === 'result' || action === 'play')) {
          featuredUntil = Date.now() + TRIKI_PIN_HOURS * 60 * 60 * 1000;
          var pinRes = await patchFeatured(postId, featuredUntil, { source: 'triki' });
          pinGranted = !!(pinRes.json && (pinRes.json.ok !== false) && pinRes.ok);
          await postBoard(BOARD_PIN_REWARDS, user, 'triki_pin_reward', postId, {
            user: user, post_id: postId, session_id: sessionId, wins: wins,
            until: featuredUntil, at: Date.now(), granted: pinGranted,
            hours: TRIKI_PIN_HOURS, source: 'triki'
          });
          await postBoard('admin', user, 'triki_pin_reward', postId, {
            message: 'TRIKI PIN REWARD · @' + user + ' · post #' + postId + ' · 3 wins · until ' + new Date(featuredUntil).toISOString()
          });
        }

        var outT = {
          ok: true,
          game: 'tic_tac_toe',
          play_id: playId,
          session_id: sessionId,
          wins: wins,
          games: gamesPlayed,
          max_games: 3,
          pin_granted: pinGranted,
          featured_until: featuredUntil || null,
          free_left: freeLeftT,
          free_left_map: snapT.free_left,
          recovery_ends_at: (snapT.recovery_ends_at && snapT.recovery_ends_at.tic_tac_toe) || 0,
          recovery_ends_at_map: snapT.recovery_ends_at || {},
          free_consumed: usedThisPlay,
          pack: !!usePackT,
          pack_spins: packLeftT,
          anon: !!player.anon,
          xp_eligible: !player.anon,
          show_challenges: String(result) === 'loss',
          opponent: 'ruiningsubs'
        };
        recent.set(lockKey, { at: Date.now(), body: outT });
        return json(res, 200, outT);
      }

      return json(res, 400, { ok: false, error: 'unknown_triki_action' });
    }

    return json(res, 400, { ok: false, error: 'unknown_game', game: game });
  } catch (e) {
    return json(res, 500, { ok: false, error: (e && e.message) || 'server_error' });
  } finally {
    locks.delete(lockKey);
  }
};
