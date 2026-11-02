// Atomic FC spend with idempotency.
// Frontend must call this for delete / roulette / dice / custom games.
// Never trust browser-only balance mutations for these actions.

const CF_API = process.env.CF_API || 'https://ruiningsubs-api.0788adm.workers.dev';
const SITE = process.env.SITE_URL || 'https://www.ruinexpose.com';

var FC_COSTS = {
  delete: Number(process.env.FC_COST_DELETE || 50),
  roulette: Number(process.env.FC_COST_ROULETTE || 10),
  roulette_spin: Number(process.env.FC_COST_ROULETTE || 10),
  dice: Number(process.env.FC_COST_DICE || 10),
  dice_roll: Number(process.env.FC_COST_DICE || 10),
  custom_roulette: Number(process.env.FC_COST_CUSTOM_ROULETTE || 250),
  custom_dice: Number(process.env.FC_COST_CUSTOM_ROULETTE || 250),
  pin: Number(process.env.FC_COST_PIN || 50),
  pin7: 150,
  pin30: 400,
  print: 350,
  vanish: 200,
  page: 1000
};

var ACTION_ALIASES = {
  roulette_spin: 'roulette',
  dice_roll: 'dice',
  remove: 'delete',
  custom_wheel: 'custom_roulette',
  custom_die: 'custom_dice'
};

// In-process idempotency + double-click lock (best-effort on serverless).
var recentSpends = new Map();
var locks = new Map();

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
  return String(u || '').replace(/^@/, '').trim().slice(0, 40);
}

function normAction(a) {
  a = String(a || '').trim().toLowerCase();
  if (ACTION_ALIASES[a]) a = ACTION_ALIASES[a];
  return a;
}

function costFor(action) {
  return Number(FC_COSTS[action] || 0) || 0;
}

function idemKey(user, action, ref) {
  return user + '|' + action + '|' + String(ref || '');
}

async function cfFetch(path, opts) {
  var r = await fetch(CF_API + path, Object.assign({ cache: 'no-store' }, opts || {}));
  var j = await r.json().catch(function () { return {}; });
  return { ok: r.ok, status: r.status, json: j };
}

async function findLedgerSpend(user, action, ref, minCoins) {
  var res = await cfFetch('/wallet/ledger?user=' + encodeURIComponent(user));
  var rows = (res.json && res.json.ledger) || [];
  for (var i = 0; i < rows.length; i++) {
    var row = rows[i] || {};
    if (String(row.kind || '') !== 'spend') continue;
    if (String(row.action || '') !== String(action)) continue;
    if (String(row.ref_id || row.ref || '') !== String(ref || '')) continue;
    if (Number(row.coins || 0) < Number(minCoins || 0)) continue;
    return row;
  }
  return null;
}

async function spendFc(user, action, ref, cost) {
  var existing = await findLedgerSpend(user, action, ref, cost);
  if (existing) {
    return { ok: true, reused: true, balance: null, ledger: existing, coins: cost, action: action };
  }

  var res = await cfFetch('/wallet', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: SITE },
    body: JSON.stringify({
      user: user,
      spend: cost,
      action: action,
      ref: ref
    })
  });

  if (res.json && res.json.ok) {
    return {
      ok: true,
      reused: false,
      balance: res.json.balance != null ? Number(res.json.balance) : null,
      coins: cost,
      action: action,
      spend: res.json
    };
  }

  var err = String((res.json && (res.json.error || res.json.message)) || '');
  if (/insufficient|not enough|balance/i.test(err) || res.status === 402 || res.status === 400) {
    return { ok: false, error: 'insufficient', need: cost, balance: Number((res.json && res.json.balance) || 0) || 0 };
  }
  return { ok: false, error: err || 'spend_failed', status: res.status };
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return json(res, 204, {});
  if (req.method === 'GET') {
    return json(res, 200, {
      ok: true,
      costs: {
        delete: FC_COSTS.delete,
        roulette: FC_COSTS.roulette,
        dice: FC_COSTS.dice,
        custom_roulette: FC_COSTS.custom_roulette
      },
      packs: [
        { usd: 5, coins: 60 },
        { usd: 10, coins: 120 },
        { usd: 15, coins: 180 },
        { usd: 25, coins: 300 },
        { usd: 50, coins: 600 },
        { usd: 99, coins: 1200 }
      ]
    });
  }
  if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'method_not_allowed' });

  var body;
  try {
    body = await readBody(req);
  } catch (e) {
    return json(res, 400, { ok: false, error: 'invalid_json' });
  }

  var user = normUser(body.user || body.username || '');
  var action = normAction(body.action || body.kind || '');
  var ref = String(body.ref || body.refId || body.idempotency_key || '').trim().slice(0, 120);
  var costOverride = Number(body.coins || body.cost || 0) || 0;
  var cost = costFor(action);

  if (!user || user === 'anon' || user === 'guest') {
    return json(res, 401, { ok: false, error: 'login_required' });
  }
  if (!action || !cost) {
    return json(res, 400, { ok: false, error: 'unknown_action', action: action });
  }
  // Never allow client to underpay; allow exact match only if equal to catalog.
  if (costOverride && costOverride !== cost) {
    return json(res, 400, { ok: false, error: 'cost_mismatch', need: cost });
  }
  if (!ref) {
    ref = action + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  }

  var key = idemKey(user, action, ref);
  var cached = recentSpends.get(key);
  if (cached && Date.now() - cached.at < 10 * 60 * 1000) {
    return json(res, 200, Object.assign({ ok: true, reused: true, coins: cost, action: action, balance: cached.balance }, cached.body || {}));
  }
  if (locks.get(key)) {
    return json(res, 409, { ok: false, error: 'in_progress', message: 'Request already in progress' });
  }
  locks.set(key, Date.now());

  try {
    var result = await spendFc(user, action, ref, cost);
    if (!result.ok) {
      if (result.error === 'insufficient') {
        return json(res, 402, {
          ok: false,
          error: 'insufficient',
          message: 'Insufficient FC',
          need: cost,
          balance: result.balance || 0,
          action: action
        });
      }
      return json(res, 502, { ok: false, error: result.error || 'spend_failed', action: action, need: cost });
    }

    var bodyOut = {
      ok: true,
      reused: !!result.reused,
      coins: cost,
      action: action,
      ref: ref,
      balance: result.balance,
      label: '-' + cost + ' FC — ' + action
    };
    recentSpends.set(key, { at: Date.now(), balance: result.balance, body: bodyOut });
    // prune
    if (recentSpends.size > 500) {
      var now = Date.now();
      recentSpends.forEach(function (v, k) {
        if (now - v.at > 15 * 60 * 1000) recentSpends.delete(k);
      });
    }
    return json(res, 200, bodyOut);
  } catch (e) {
    return json(res, 500, { ok: false, error: (e && e.message) || 'server_error' });
  } finally {
    locks.delete(key);
  }
};
