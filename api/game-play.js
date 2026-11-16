// Game play intake: roulette / dice / tic_tac_toe.
// Free uses: 3 per game per cycle, then 24h recovery (independent counters).
// Anonymous sessions, pin rewards, XP-safe. Does NOT touch PayPal / Throne payment flows.

const CF_API = process.env.CF_API || 'https://ruiningsubs-api.0788adm.workers.dev';
const SITE = process.env.SITE_URL || 'https://www.ruinexpose.com';
const FC_ROULETTE = Number(process.env.FC_COST_ROULETTE || 10);
const FC_ROULETTE_PACK = Number(process.env.FC_COST_ROULETTE_PACK || 50);
const ROULETTE_PACK_SPINS = Number(process.env.ROULETTE_PACK_SPINS || 10);
const FREE_USES_PER_GAME = Number(process.env.FREE_USES_PER_GAME || 3);
const FREE_RECOVERY_MS = Number(process.env.FREE_RECOVERY_MS || (24 * 60 * 60 * 1000));
const FC_DICE = Number(process.env.FC_COST_DICE || 10);
const FC_CUSTOM = Number(process.env.FC_COST_CUSTOM_ROULETTE || 250);
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
  return String(v || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 48);
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
    return json(res, 200, {
      ok: true,
      anonymous_user_id: resolved.id,
      account_type: 'anonymous',
      linked_to: registered,
      username: resolved.username
    }, { 'Set-Cookie': cookie });
  }
  return json(res, 200, {
    ok: true,
    anonymous_user_id: resolved.id,
    account_type: 'anonymous',
    username: resolved.username,
    created: !!resolved.created
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

/** Idempotent pack credit — returns { granted, reused, pack_spins }. */
async function grantRoulettePack(user, playId, meta) {
  meta = meta || {};
  var packs = await fetchBoard(BOARD_PACKS);
  for (var i = 0; i < packs.length; i++) {
    var msg = parseMsg(packs[i] && packs[i].message);
    if (!msg) continue;
    if (normUser(msg.user || packs[i].from_username) !== normUser(user)) continue;
    if (msg.kind !== 'pack_purchase') continue;
    var pid = String(msg.play_id || msg.request_id || packs[i].post_id || '');
    if (pid && (pid === String(playId) || pid === String(meta.request_id || ''))) {
      return {
        ok: true,
        reused: true,
        spins_granted: 0,
        pack_spins: roulettePackBalance(packs, user)
      };
    }
  }
  await postBoard(BOARD_PACKS, user, 'roulette_pack', playId, {
    user: user,
    game: 'roulette',
    kind: 'pack_purchase',
    spins: ROULETTE_PACK_SPINS,
    coins: Number(meta.coins || 0) || 0,
    play_id: playId,
    request_id: meta.request_id || playId,
    source: meta.source || 'purchase',
    provider: meta.provider || '',
    at: Date.now(),
    usd: meta.usd != null ? meta.usd : 5,
    account_type: isAnonUser(user) ? 'anonymous' : 'registered'
  });
  await postBoard(BOARD_PLAYS, user, 'roulette_pack', playId, {
    id: playId,
    user: user,
    game: 'roulette',
    kind: 'pack_purchase',
    spins: ROULETTE_PACK_SPINS,
    coins: Number(meta.coins || 0) || 0,
    source: meta.source || 'purchase',
    at: Date.now()
  });
  var after = await fetchBoard(BOARD_PACKS);
  return {
    ok: true,
    reused: false,
    spins_granted: ROULETTE_PACK_SPINS,
    pack_spins: roulettePackBalance(after, user)
  };
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

function roulettePackBalance(notifs, user) {
  var granted = 0;
  var used = 0;
  for (var i = 0; i < notifs.length; i++) {
    var msg = parseMsg(notifs[i] && notifs[i].message);
    if (!msg) continue;
    if (normUser(msg.user || notifs[i].from_username) !== user) continue;
    if (String(msg.game || '') !== 'roulette') continue;
    if (msg.kind === 'pack_purchase') granted += Number(msg.spins || ROULETTE_PACK_SPINS) || 0;
    if (msg.kind === 'pack_spin') used += 1;
  }
  return Math.max(0, granted - used);
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
          custom: FC_CUSTOM,
          roulette_pack: FC_ROULETTE_PACK
        },
        free_per_game: FREE_USES_PER_GAME,
        free_per_day: FREE_USES_PER_GAME, // legacy alias — 3 per recovery cycle
        free_recovery_ms: FREE_RECOVERY_MS,
        roulette_pack_spins: ROULETTE_PACK_SPINS,
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

  // Admin grant / reject of external roulette pack payments (PayPal / Throne / BTC).
  if (action === 'grant_pack' || action === 'approve_pack' || action === 'reject_pack') {
    var adminTok = bearerToken(req);
    var adminOk = false;
    try { adminOk = await verifyAdminToken(adminTok); } catch (e) { adminOk = false; }
    if (!adminOk) return json(res, 401, { ok: false, error: 'admin_required' });
    var target = normUser(body.target_user || body.user || body.username || '');
    if (!target) return json(res, 400, { ok: false, error: 'need_user' });
    var reqId = String(body.request_id || body.play_id || body.ref || playId || '').trim().slice(0, 80);
    if (!reqId) reqId = 'admin_pack_' + Date.now().toString(36);
    if (action === 'reject_pack') {
      await postBoard(BOARD_PLAYS, target, 'roulette_pack_reject', reqId, {
        user: target, game: 'roulette', kind: 'pack_reject',
        request_id: reqId, at: Date.now(), reason: String(body.reason || 'rejected')
      });
      try {
        await postBoard(target, 'admin', 'roulette_pack_rejected', reqId, {
          user: target, request_id: reqId, status: 'rejected', at: Date.now(),
          message: 'Roulette pack payment rejected — no spins credited.'
        });
      } catch (e) {}
      return json(res, 200, { ok: true, status: 'rejected', request_id: reqId, user: target });
    }
    var granted = await grantRoulettePack(target, reqId, {
      source: 'admin_approve',
      provider: String(body.provider || 'external'),
      request_id: reqId,
      coins: 0,
      usd: 5
    });
    try {
      await postBoard(target, 'admin', 'roulette_unlock', reqId, {
        user: target, request_id: reqId, status: 'approved',
        spins: ROULETTE_PACK_SPINS, at: Date.now(),
        message: 'Payment verified — ' + ROULETTE_PACK_SPINS + ' roulette spins unlocked.'
      });
    } catch (e) {}
    return json(res, 200, {
      ok: true,
      status: 'approved',
      reused: !!granted.reused,
      user: target,
      request_id: reqId,
      spins_granted: granted.spins_granted,
      pack_spins: granted.pack_spins,
      account_type: isAnonUser(target) ? 'anonymous' : 'registered'
    });
  }

  if (!user) {
    return json(res, 401, { ok: false, error: 'session_required', message: 'Missing anonymous session or login' });
  }
  if (game && !LIVE_GAMES[game] && game !== 'custom_roulette' && game !== 'custom_dice') {
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
    // —— Custom private 30-option wheel/dice request (registered only) ——
    if (game === 'custom_roulette' || game === 'custom_dice') {
      if (player.anon) return json(res, 401, { ok: false, error: 'login_required' });
      if (!options || options.length < 2) {
        return json(res, 400, { ok: false, error: 'need_options', message: 'Provide 2–30 custom options' });
      }
      var cleanOpts = options.map(function (o) {
        if (typeof o === 'string') return { title: String(o).slice(0, 80) };
        return { title: String((o && (o.title || o.label || o.text)) || '').slice(0, 80), desc: String((o && o.desc) || '').slice(0, 200) };
      }).filter(function (o) { return o.title; }).slice(0, 30);
      if (cleanOpts.length < 2) return json(res, 400, { ok: false, error: 'need_options' });

      var spendCustom = await spendViaWallet(user, FC_CUSTOM, game, playId);
      if (!spendCustom.ok) {
        if (spendCustom.error === 'insufficient') {
          return json(res, 402, { ok: false, error: 'insufficient', message: 'Insufficient FC', need: FC_CUSTOM, balance: spendCustom.balance || 0 });
        }
        return json(res, 502, { ok: false, error: spendCustom.error || 'spend_failed', need: FC_CUSTOM });
      }
      await postBoard(BOARD_PLAYS, user, 'custom_game', playId, {
        id: playId, user: user, game: game, paid: true, coins: FC_CUSTOM,
        options: cleanOpts, at: Date.now(), kind: 'custom_purchase'
      });
      await postBoard('admin', user, game + '_request', playId, {
        id: playId, user: user, game: game, coins: FC_CUSTOM, usd: 25,
        options_count: cleanOpts.length, at: Date.now(),
        message: 'CUSTOM ' + game.toUpperCase() + ' · @' + user + ' · 250 FC / $25 · ' + cleanOpts.length + ' options'
      });
      var outCustom = {
        ok: true,
        reused: !!spendCustom.reused,
        game: game,
        play_id: playId,
        coins: FC_CUSTOM,
        balance: spendCustom.balance,
        options: cleanOpts,
        private: true,
        label: '-' + FC_CUSTOM + ' FC — custom ' + game
      };
      recent.set(lockKey, { at: Date.now(), body: outCustom });
      return json(res, 200, outCustom);
    }

    // —— Roulette pack: 50 FC → 10 prepaid spins (registered + stable anonymous) ——
    if (game === 'roulette' && (action === 'buy_pack' || action === 'roulette_pack')) {
      var packSpend = await spendViaWallet(user, FC_ROULETTE_PACK, 'roulette_pack', playId);
      if (!packSpend.ok) {
        if (packSpend.error === 'insufficient') {
          return json(res, 402, {
            ok: false,
            error: 'insufficient',
            message: 'Insufficient FC',
            need: FC_ROULETTE_PACK,
            balance: packSpend.balance || 0
          });
        }
        if (packSpend.error === 'login_required_for_paid') {
          return json(res, 401, { ok: false, error: 'session_required', message: 'Anonymous identity required' });
        }
        return json(res, 502, { ok: false, error: packSpend.error || 'spend_failed', need: FC_ROULETTE_PACK });
      }
      var grantedPack = { ok: true, reused: true, spins_granted: 0, pack_spins: 0 };
      if (!packSpend.reused) {
        grantedPack = await grantRoulettePack(user, playId, {
          source: 'fc',
          provider: 'fc',
          coins: FC_ROULETTE_PACK,
          usd: 5,
          request_id: playId
        });
      } else {
        grantedPack.pack_spins = roulettePackBalance(await fetchBoard(BOARD_PACKS), user);
      }
      var outPack = {
        ok: true,
        reused: !!packSpend.reused || !!grantedPack.reused,
        game: 'roulette',
        action: 'buy_pack',
        play_id: playId,
        coins: FC_ROULETTE_PACK,
        spins_granted: packSpend.reused ? 0 : (grantedPack.spins_granted || ROULETTE_PACK_SPINS),
        pack_spins: grantedPack.pack_spins,
        balance: packSpend.balance,
        anon: !!player.anon,
        account_type: player.anon ? 'anonymous' : 'registered',
        anonymous_user_id: player.anonId || null,
        label: packSpend.reused
          ? 'Already credited'
          : ('-' + FC_ROULETTE_PACK + ' FC — ' + ROULETTE_PACK_SPINS + ' roulette spins')
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
      var packBoard = (game === 'roulette') ? await fetchBoard(BOARD_PACKS) : [];
      var packLeft = (game === 'roulette') ? roulettePackBalance(packBoard, user) : 0;
      var useFree = !forcePaid && freeLeftNow > 0;
      var usePack = !useFree && game === 'roulette' && packLeft > 0;
      var cost = game === 'roulette' ? FC_ROULETTE : FC_DICE;
      var balance = null;
      var reused = false;
      var coinsCharged = 0;

      if (useFree) {
        paid = false;
        await recordFreeUse(user, game, playId);
      } else if (usePack) {
        paid = true;
        coinsCharged = 0;
        await postBoard(BOARD_PACKS, user, 'roulette_pack_spin', playId, {
          user: user, game: 'roulette', kind: 'pack_spin', play_id: playId, at: Date.now(),
          account_type: player.anon ? 'anonymous' : 'registered'
        });
      } else {
        // Prefer buying a 10-spin pack (50 FC) over single-spin charges when free+pack are empty.
        // Single-spin FC path remains for dice; roulette directs clients to the pack purchase UI.
        if (game === 'roulette') {
          return json(res, 402, {
            ok: false,
            error: 'free_exhausted',
            message: 'Free uses exhausted. Get 10 additional spins for ' + FC_ROULETTE_PACK + ' FC ($5).',
            free_left: 0,
            recovery_ends_at: recoveryEndsNow || null,
            recovery_ms: recoveryEndsNow ? Math.max(0, recoveryEndsNow - Date.now()) : 0,
            pack_spins: packLeft,
            need: FC_ROULETTE_PACK,
            pack_available: true,
            anon: !!player.anon
          });
        }
        paid = true;
        var spend = await spendViaWallet(user, cost, game, playId);
        if (!spend.ok) {
          if (spend.error === 'insufficient') {
            return json(res, 402, {
              ok: false,
              error: 'insufficient',
              message: 'Insufficient FC',
              need: cost,
              balance: spend.balance || 0,
              free_left: freeLeftNow,
              recovery_ends_at: recoveryEndsNow || null,
              pack_spins: packLeft
            });
          }
          return json(res, 502, { ok: false, error: spend.error || 'spend_failed', need: cost });
        }
        balance = spend.balance;
        reused = !!spend.reused;
        coinsCharged = cost;
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
        resultIdx = Math.floor(Math.random() * optionCount);
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

      var packsLeftAfter = (game === 'roulette')
        ? roulettePackBalance(await fetchBoard(BOARD_PACKS), user)
        : 0;
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
            : ('-' + coinsCharged + ' FC — ' + game))
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
        var consumeFree = action === 'consume_free' || action === 'start' || (action === 'play' && !body.skip_free);

        // First play of a challenge session consumes one free use (unless paid / already counted)
        var usedThisPlay = false;
        if (consumeFree && !forcePaid && !body.paid) {
          if (freeLeftT <= 0 && action !== 'result') {
            var recT = (snapT.recovery_ends_at && snapT.recovery_ends_at.tic_tac_toe) || 0;
            return json(res, 402, {
              ok: false,
              error: 'free_exhausted',
              message: 'Free Tic-Tac-Toe uses exhausted. Wait 24h recovery.',
              free_left: 0,
              free_left_map: snapT.free_left,
              recovery_ends_at: recT || null,
              recovery_ms: recT ? Math.max(0, recT - Date.now()) : 0,
              recovery_ends_at_map: snapT.recovery_ends_at || {}
            });
          }
          if (action === 'consume_free' || action === 'start' || (action === 'play' && gamesPlayed <= 1)) {
            // Deduplicate by session: only one free charge per challenge session
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
