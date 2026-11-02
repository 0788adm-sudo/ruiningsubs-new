// Game play intake: roulette / dice / triki.
// Charges FC server-side when paid, records result on CF notifs boards,
// and grants pin reward after 3 Triki wins in a challenge session.

const CF_API = process.env.CF_API || 'https://ruiningsubs-api.0788adm.workers.dev';
const SITE = process.env.SITE_URL || 'https://www.ruinexpose.com';
const FC_ROULETTE = Number(process.env.FC_COST_ROULETTE || 10);
const FC_DICE = Number(process.env.FC_COST_DICE || 10);
const FC_CUSTOM = Number(process.env.FC_COST_CUSTOM_ROULETTE || 250);
const TRIKI_PIN_HOURS = Number(process.env.TRIKI_PIN_HOURS || 48);
const BOARD_PLAYS = '__GAME_PLAYS__';
const BOARD_FREE = '__GAME_FREE_DAY__';
const BOARD_TRIKI = '__TRIKI_SESSIONS__';
const BOARD_PIN_REWARDS = '__PIN_REWARDS__';

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
  return String(u || '').replace(/^@/, '').trim().toLowerCase().slice(0, 40);
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
  // Idempotent: reuse ledger row with same ref
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

function countFreeToday(notifs, user, game) {
  var day = dayKey();
  var n = 0;
  for (var i = 0; i < notifs.length; i++) {
    var msg = parseMsg(notifs[i] && notifs[i].message);
    if (!msg) continue;
    if (normUser(msg.user || notifs[i].from_username) !== user) continue;
    if (String(msg.game || '') !== game) continue;
    if (String(msg.day || '') !== day) continue;
    if (msg.paid) continue;
    n++;
  }
  return n;
}

async function patchFeatured(postId, until) {
  var res = await cfFetch('/posts/' + encodeURIComponent(String(postId)), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Origin: SITE },
    body: JSON.stringify({ featured_until: until || 0 })
  });
  return res;
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return json(res, 204, {});

  if (req.method === 'GET') {
    var qUser = normUser((req.query && (req.query.user || req.query.username)) || '');
    var qGame = String((req.query && req.query.game) || '').toLowerCase();
    try {
      var plays = await fetchBoard(BOARD_PLAYS);
      var free = await fetchBoard(BOARD_FREE);
      var out = {
        ok: true,
        costs: { roulette: FC_ROULETTE, dice: FC_DICE, custom: FC_CUSTOM },
        free_per_day: 1,
        triki_max_games: 3,
        triki_wins_for_pin: 3,
        triki_pin_hours: TRIKI_PIN_HOURS
      };
      if (qUser) {
        out.free_used = {
          roulette: countFreeToday(free, qUser, 'roulette'),
          dice: countFreeToday(free, qUser, 'dice')
        };
        out.plays = plays
          .map(function (n) { return parseMsg(n.message); })
          .filter(function (m) {
            if (!m) return false;
            if (normUser(m.user) !== qUser) return false;
            if (qGame && String(m.game || '') !== qGame) return false;
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

  var user = normUser(body.user || body.username || '');
  var game = String(body.game || body.kind || '').toLowerCase().trim();
  var playId = String(body.play_id || body.ref || body.idempotency_key || '').trim().slice(0, 80);
  var result = body.result || null;
  var paid = !!body.paid;
  var forcePaid = !!body.force_paid;
  var options = Array.isArray(body.options) ? body.options.slice(0, 30) : null;
  var postId = String(body.post_id || body.postId || '').trim();
  var sessionId = String(body.session_id || body.sessionId || '').trim().slice(0, 80);
  var wins = Number(body.wins || 0) || 0;
  var gamesPlayed = Number(body.games || body.games_played || 0) || 0;

  if (!user || user === 'anon' || user === 'guest') {
    return json(res, 401, { ok: false, error: 'login_required' });
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
    // —— Custom private 30-option wheel/dice request ——
    if (game === 'custom_roulette' || game === 'custom_dice') {
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

    // —— Roulette / Dice spin ——
    if (game === 'roulette' || game === 'dice') {
      var freeBoard = await fetchBoard(BOARD_FREE);
      var freeUsed = countFreeToday(freeBoard, user, game);
      var useFree = !forcePaid && freeUsed < 1;
      var cost = game === 'roulette' ? FC_ROULETTE : FC_DICE;
      var balance = null;
      var reused = false;

      if (!useFree) {
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
              free_left: Math.max(0, 1 - freeUsed)
            });
          }
          return json(res, 502, { ok: false, error: spend.error || 'spend_failed', need: cost });
        }
        balance = spend.balance;
        reused = !!spend.reused;
      } else {
        paid = false;
        await postBoard(BOARD_FREE, user, 'free_play', playId, {
          user: user, game: game, day: dayKey(), play_id: playId, at: Date.now(), paid: false
        });
      }

      await postBoard(BOARD_PLAYS, user, game + '_play', playId, {
        id: playId,
        user: user,
        game: game,
        paid: paid,
        coins: paid ? cost : 0,
        result: result || null,
        at: Date.now()
      });

      var outSpin = {
        ok: true,
        reused: reused,
        game: game,
        play_id: playId,
        paid: paid,
        free: !paid,
        coins: paid ? cost : 0,
        balance: balance,
        free_left: paid ? Math.max(0, 1 - freeUsed) : 0,
        label: paid ? ('-' + cost + ' FC — ' + game) : ('Free ' + game + ' spin')
      };
      recent.set(lockKey, { at: Date.now(), body: outSpin });
      return json(res, 200, outSpin);
    }

    // —— Triki session / pin reward ——
    if (game === 'triki' || game === 'tic_tac_toe') {
      var action = String(body.action || 'play').toLowerCase();
      if (!sessionId) sessionId = 'ttt_' + user + '_' + dayKey();

      if (action === 'play' || action === 'result') {
        if (gamesPlayed > 3) {
          return json(res, 400, { ok: false, error: 'max_games', message: 'Max 3 games per challenge session', max: 3 });
        }
        await postBoard(BOARD_PLAYS, user, 'triki_play', playId, {
          id: playId, user: user, game: 'tic_tac_toe', session_id: sessionId,
          result: result, wins: wins, games: gamesPlayed, at: Date.now()
        });
        await postBoard(BOARD_TRIKI, user, 'triki_session', sessionId, {
          user: user, session_id: sessionId, wins: wins, games: gamesPlayed,
          result: result, play_id: playId, at: Date.now()
        });

        var pinGranted = false;
        var featuredUntil = 0;
        if (wins >= 3 && postId) {
          featuredUntil = Date.now() + TRIKI_PIN_HOURS * 60 * 60 * 1000;
          var pinRes = await patchFeatured(postId, featuredUntil);
          pinGranted = !!(pinRes.json && (pinRes.json.ok !== false) && pinRes.ok);
          await postBoard(BOARD_PIN_REWARDS, user, 'triki_pin_reward', postId, {
            user: user, post_id: postId, session_id: sessionId, wins: wins,
            until: featuredUntil, at: Date.now(), granted: pinGranted,
            hours: TRIKI_PIN_HOURS
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
