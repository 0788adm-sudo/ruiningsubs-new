// Game play intake: roulette / dice / tic_tac_toe.
// Lifetime free uses (3 per game), anonymous sessions, pin rewards, XP-safe.
// Does NOT touch PayPal / Throne payment flows.

const CF_API = process.env.CF_API || 'https://ruiningsubs-api.0788adm.workers.dev';
const SITE = process.env.SITE_URL || 'https://www.ruinexpose.com';
const FC_ROULETTE = Number(process.env.FC_COST_ROULETTE || 10);
const FC_ROULETTE_PACK = Number(process.env.FC_COST_ROULETTE_PACK || 50);
const ROULETTE_PACK_SPINS = Number(process.env.ROULETTE_PACK_SPINS || 10);
const FREE_USES_PER_GAME = Number(process.env.FREE_USES_PER_GAME || 3);
const FC_DICE = Number(process.env.FC_COST_DICE || 10);
const FC_CUSTOM = Number(process.env.FC_COST_CUSTOM_ROULETTE || 250);
const TRIKI_PIN_HOURS = Number(process.env.TRIKI_PIN_HOURS || 48);
const ROULETTE_PIN_HOURS = Number(process.env.ROULETTE_PIN_HOURS || 48);
const BOARD_PLAYS = '__GAME_PLAYS__';
const BOARD_FREE = '__GAME_FREE_USES__';
const BOARD_FREE_LEGACY = '__GAME_FREE_DAY__';
const BOARD_PACKS = '__ROULETTE_PACKS__';
const BOARD_TRIKI = '__TRIKI_SESSIONS__';
const BOARD_PIN_REWARDS = '__PIN_REWARDS__';
const LIVE_GAMES = { roulette: 1, dice: 1, tic_tac_toe: 1, triki: 1 };

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

function resolvePlayer(body, query) {
  var registered = normUser((body && (body.user || body.username)) || (query && (query.user || query.username)) || '');
  var anonRaw = String((body && (body.anon_id || body.anonId || body.session_token)) || (query && (query.anon_id || query.anonId)) || '').trim();
  anonRaw = anonRaw.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 48);
  if (registered && !isAnonUser(registered)) {
    return { user: registered, anon: false, registered: true };
  }
  if (anonRaw && anonRaw.length >= 8) {
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
  if (isAnonUser(user)) {
    return { ok: false, error: 'login_required_for_paid' };
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

/** Lifetime free-use counter (does NOT reset by day). Merges legacy daily board. */
function countFreeUses(notifs, user, game) {
  var n = 0;
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
    n++;
  }
  return n;
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

function freeLeftFor(used) {
  return Math.max(0, FREE_USES_PER_GAME - (Number(used) || 0));
}

function freeSnapshot(freeBoard, user) {
  var usedR = countFreeUses(freeBoard, user, 'roulette');
  var usedD = countFreeUses(freeBoard, user, 'dice');
  var usedT = countFreeUses(freeBoard, user, 'tic_tac_toe');
  return {
    free_used: { roulette: usedR, dice: usedD, tic_tac_toe: usedT },
    free_left: {
      roulette: freeLeftFor(usedR),
      dice: freeLeftFor(usedD),
      tic_tac_toe: freeLeftFor(usedT)
    },
    free_per_game: FREE_USES_PER_GAME
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
    lifetime: true
  });
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
    var player = resolvePlayer(null, req.query || {});
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
        free_per_day: FREE_USES_PER_GAME, // legacy alias — value is lifetime, not daily
        roulette_pack_spins: ROULETTE_PACK_SPINS,
        live_games: ['roulette', 'dice', 'tic_tac_toe'],
        triki_max_games: 3,
        triki_wins_for_pin: 3,
        triki_pin_hours: TRIKI_PIN_HOURS,
        roulette_pin_hours: ROULETTE_PIN_HOURS
      };
      if (player.user) {
        Object.assign(out, freeSnapshot(free, player.user));
        out.anon = !!player.anon;
        out.pack_spins = player.anon ? 0 : roulettePackBalance(packs, player.user);
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

  var player = resolvePlayer(body, null);
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

    // —— Roulette pack: 50 FC → 10 prepaid spins (registered only) ——
    if (game === 'roulette' && (action === 'buy_pack' || action === 'roulette_pack')) {
      if (player.anon) return json(res, 401, { ok: false, error: 'login_required' });
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
        return json(res, 502, { ok: false, error: packSpend.error || 'spend_failed', need: FC_ROULETTE_PACK });
      }
      if (!packSpend.reused) {
        await postBoard(BOARD_PACKS, user, 'roulette_pack', playId, {
          user: user, game: 'roulette', kind: 'pack_purchase',
          spins: ROULETTE_PACK_SPINS, coins: FC_ROULETTE_PACK,
          play_id: playId, at: Date.now(), usd: 5
        });
        await postBoard(BOARD_PLAYS, user, 'roulette_pack', playId, {
          id: playId, user: user, game: 'roulette', kind: 'pack_purchase',
          spins: ROULETTE_PACK_SPINS, coins: FC_ROULETTE_PACK, at: Date.now()
        });
      }
      var packsAfter = await fetchBoard(BOARD_PACKS);
      var outPack = {
        ok: true,
        reused: !!packSpend.reused,
        game: 'roulette',
        action: 'buy_pack',
        play_id: playId,
        coins: FC_ROULETTE_PACK,
        spins_granted: packSpend.reused ? 0 : ROULETTE_PACK_SPINS,
        pack_spins: roulettePackBalance(packsAfter, user),
        balance: packSpend.balance,
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

    // —— Roulette / Dice spin ——
    if (game === 'roulette' || game === 'dice') {
      var freeBoard = await loadFreeBoards();
      var snap = freeSnapshot(freeBoard, user);
      var freeUsed = snap.free_used[game] || 0;
      var freeLeftNow = snap.free_left[game] || 0;
      var packBoard = (!player.anon && game === 'roulette') ? await fetchBoard(BOARD_PACKS) : [];
      var packLeft = (!player.anon && game === 'roulette') ? roulettePackBalance(packBoard, user) : 0;
      var useFree = !forcePaid && freeLeftNow > 0;
      var usePack = !useFree && !player.anon && game === 'roulette' && packLeft > 0;
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
          user: user, game: 'roulette', kind: 'pack_spin', play_id: playId, at: Date.now()
        });
      } else {
        if (player.anon) {
          return json(res, 402, {
            ok: false,
            error: 'free_exhausted',
            message: 'Free uses exhausted. Register to buy more plays with FC.',
            free_left: 0,
            need: cost
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
              pack_spins: packLeft
            });
          }
          return json(res, 502, { ok: false, error: spend.error || 'spend_failed', need: cost });
        }
        balance = spend.balance;
        reused = !!spend.reused;
        coinsCharged = cost;
      }

      var pinPrize = !!(body.pin_prize || (result && result.pin) || (result && result.pin_prize));
      await postBoard(BOARD_PLAYS, user, game + '_play', playId, {
        id: playId,
        user: user,
        game: game,
        paid: paid,
        free: !!useFree,
        pack: !!usePack,
        coins: coinsCharged,
        result: result || null,
        pin_prize: pinPrize,
        anon: !!player.anon,
        at: Date.now()
      });

      var packsLeftAfter = (!player.anon && game === 'roulette')
        ? roulettePackBalance(await fetchBoard(BOARD_PACKS), user)
        : 0;
      var freeLeftAfter = useFree ? Math.max(0, freeLeftNow - 1) : freeLeftNow;
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
        free_left_map: Object.assign({}, snap.free_left, (function () {
          var m = {};
          m[game] = freeLeftAfter;
          return m;
        })()),
        pack_spins: packsLeftAfter,
        anon: !!player.anon,
        xp_eligible: !player.anon,
        pin_prize: pinPrize,
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
            return json(res, 402, {
              ok: false,
              error: 'free_exhausted',
              message: 'Free Tic-Tac-Toe uses exhausted',
              free_left: 0,
              free_left_map: snapT.free_left
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
                session_id: sessionId, at: Date.now(), paid: false, lifetime: true
              });
              usedThisPlay = true;
              freeLeftT = Math.max(0, freeLeftT - 1);
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
          free_consumed: usedThisPlay,
          anon: !!player.anon,
          xp_eligible: !player.anon,
          show_challenges: String(result) === 'loss'
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
