// Secure Street Print intake.
// Frontend must call this endpoint — do not trust browser-only payment flags.
// Validates 1–5 photos + real FC spend (CF wallet) OR Throne payment screenshot,
// then creates the CF print_request and notifies @mastersan.

const CF_API = process.env.CF_API || 'https://ruiningsubs-api.0788adm.workers.dev';
const SITE = process.env.SITE_URL || 'https://www.ruiningsubs.com';
const PRINT_FC_COST = Number(process.env.PRINT_FC_COST || 350);
const ALLOWED_PROOF_HOSTS = (
  process.env.PRINT_PROOF_HOSTS ||
  'pub-b65c88e28c02405ba88db599e7c80d0f.r2.dev,ruiningsubs-api.0788adm.workers.dev,snlpdolzhzcbbdyxqlnb.supabase.co,www.ruiningsubs.com,ruiningsubs.com'
).split(',').map(function (s) { return s.trim().toLowerCase(); }).filter(Boolean);

// In-process idempotency (best-effort on serverless; order_code also stored on the CF request).
var recentOrders = new Map();

function json(res, code, body) {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
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

function isHttpsUrl(u) {
  try {
    var x = new URL(String(u || ''));
    return x.protocol === 'https:';
  } catch (e) {
    return false;
  }
}

function hostAllowed(u) {
  try {
    var h = new URL(String(u)).hostname.toLowerCase();
    return ALLOWED_PROOF_HOSTS.some(function (allowed) {
      return h === allowed || h.endsWith('.' + allowed);
    });
  } catch (e) {
    return false;
  }
}

function validOrderCode(code) {
  return /^PR-[A-Z0-9]{4,16}$/i.test(String(code || ''));
}

function cleanPhotos(arr) {
  if (!Array.isArray(arr)) return [];
  var out = [];
  for (var i = 0; i < arr.length; i++) {
    var u = String(arr[i] || '').trim();
    if (!isHttpsUrl(u)) continue;
    if (/^data:/i.test(u)) continue;
    out.push(u);
    if (out.length > 5) break;
  }
  return out;
}

async function cfFetch(path, opts) {
  var r = await fetch(CF_API + path, Object.assign({ cache: 'no-store' }, opts || {}));
  var j = await r.json().catch(function () { return {}; });
  return { ok: r.ok, status: r.status, json: j };
}

async function findLedgerPrintSpend(user, orderCode) {
  var res = await cfFetch('/wallet/ledger?user=' + encodeURIComponent(user));
  var rows = (res.json && res.json.ledger) || [];
  for (var i = 0; i < rows.length; i++) {
    var row = rows[i] || {};
    if (String(row.kind || '') !== 'spend') continue;
    if (String(row.action || '') !== 'print') continue;
    if (String(row.ref_id || row.ref || '') !== String(orderCode)) continue;
    if (Number(row.coins || 0) < PRINT_FC_COST) continue;
    return row;
  }
  return null;
}

async function spendPrintFc(user, orderCode) {
  var existing = await findLedgerPrintSpend(user, orderCode);
  if (existing) return { ok: true, reused: true, ledger: existing };

  var res = await cfFetch('/wallet', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: SITE },
    body: JSON.stringify({
      user: user,
      spend: PRINT_FC_COST,
      action: 'print',
      ref: orderCode
    })
  });
  if (res.json && res.json.ok) {
    return { ok: true, reused: false, spend: res.json };
  }
  return {
    ok: false,
    error: (res.json && res.json.error) || 'fc_spend_failed',
    balance: res.json && res.json.balance
  };
}

async function createCfPrintRequest(payload) {
  var res = await cfFetch('/requests', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: SITE },
    body: JSON.stringify(payload)
  });
  if (!res.ok || res.json.ok === false) {
    throw new Error((res.json && res.json.error) || ('CF request HTTP ' + res.status));
  }
  return res.json.request || res.json;
}

async function notifyMastersan(order) {
  var message =
    '🖨️ NEW PRINT ORDER\n\n' +
    'Order: ' + order.order_code + '\n' +
    'User: @' + order.user + '\n' +
    'Payment: ' + order.payment_label + '\n' +
    'Photos: ' + order.photo_count + '\n\n' +
    'New print request received.\n' +
    'Open Admin → Requests → Print · ' + (order.request_id || order.order_code);

  // CF internal notifs (Inbox)
  await cfFetch('/notifs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: SITE },
    body: JSON.stringify({
      to: 'mastersan',
      to_username: 'mastersan',
      from: order.user,
      from_username: order.user,
      type: 'print_order',
      post_id: order.request_id || '',
      message: message
    })
  }).catch(function () { return null; });

  // Also ping common admin aliases used by the existing inbox
  var aliases = ['MasterSan', 'mastersan01', 'admin'];
  for (var i = 0; i < aliases.length; i++) {
    await cfFetch('/notifs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: SITE },
      body: JSON.stringify({
        to: aliases[i],
        to_username: aliases[i],
        from: order.user,
        from_username: order.user,
        type: 'print_order',
        post_id: order.request_id || '',
        message: message
      })
    }).catch(function () { return null; });
  }
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Idempotency-Key');
    return res.end();
  }
  if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'method_not_allowed' });

  try {
    var body = await readBody(req);
    var orderCode = String(body.order_code || body.orderCode || '').trim().toUpperCase();
    var user = normUser(body.user || body.username || body.author || 'anon');
    var name = String(body.name || user).trim().slice(0, 120);
    var socials = String(body.socials || '').trim().slice(0, 800);
    var age = String(body.age || '').trim().slice(0, 40);
    var city = String(body.city || '').trim().slice(0, 80);
    var rawPhotos = Array.isArray(body.photos) ? body.photos : [];
    if (rawPhotos.length > 5) {
      return json(res, 400, {
        ok: false,
        error: 'invalid_photo_count',
        message: 'Maximum 5 flyer photos (got ' + rawPhotos.length + ')'
      });
    }
    var photos = cleanPhotos(rawPhotos);
    var paymentMethod = String(body.payment_method || body.paid_via || '').toLowerCase();
    var paymentProof = String(body.payment_proof || body.proof || '').trim();
    var idem = String((req.headers && (req.headers['idempotency-key'] || req.headers['Idempotency-Key'])) || orderCode).trim().toUpperCase();

    if (!validOrderCode(orderCode)) {
      return json(res, 400, { ok: false, error: 'invalid_order_code', message: 'Order code PR-XXXX is required' });
    }
    if (photos.length < 1 || photos.length > 5) {
      return json(res, 400, {
        ok: false,
        error: 'invalid_photo_count',
        message: 'Send between 1 and 5 flyer photos (got ' + photos.length + ')'
      });
    }

    if (recentOrders.has(idem)) {
      return json(res, 200, Object.assign({ ok: true, deduped: true }, recentOrders.get(idem)));
    }

    var paidVia = '';
    var amountLabel = '';
    var status = 'pending_payment';
    var fcMeta = null;

    if (paymentMethod === 'fc' || paymentMethod === 'coins' || paymentMethod === 'fag') {
      var spend = await spendPrintFc(user, orderCode);
      if (!spend.ok) {
        return json(res, 402, {
          ok: false,
          error: spend.error === 'insufficient' ? 'insufficient_fc' : 'fc_payment_failed',
          message: spend.error === 'insufficient'
            ? ('Not enough FC (need ' + PRINT_FC_COST + ')')
            : 'Could not verify FC payment',
          balance: spend.balance
        });
      }
      paidVia = 'fc';
      amountLabel = PRINT_FC_COST + ' FC';
      status = 'paid';
      fcMeta = { reused: !!spend.reused, ledger: spend.ledger || null, spend: spend.spend || null };
    } else if (paymentMethod === 'throne' || paymentMethod === 'throne_proof' || paymentMethod === 'manual') {
      if (!paymentProof || !isHttpsUrl(paymentProof)) {
        return json(res, 402, {
          ok: false,
          error: 'payment_proof_required',
          message: 'Upload a Throne payment screenshot before sending'
        });
      }
      if (!hostAllowed(paymentProof)) {
        return json(res, 400, {
          ok: false,
          error: 'payment_proof_host_blocked',
          message: 'Payment screenshot must be uploaded through the site'
        });
      }
      paidVia = 'throne_proof';
      amountLabel = '$40';
      status = 'paid';
    } else {
      return json(res, 402, {
        ok: false,
        error: 'payment_required',
        message: 'Pay 350 FC or upload a Throne payment screenshot'
      });
    }

    // Never trust client paid=true / provider alone — only the branches above set paidVia.
    var requestPayload = {
      name: name,
      age: age,
      city: city,
      socials: socials,
      photos: photos,
      payment_proof: paidVia === 'throne_proof' ? paymentProof : '',
      order_code: orderCode,
      paid_via: paidVia,
      payment_status: status,
      author: user,
      user_id: user,
      consent: true,
      photo_count: photos.length,
      submitted_via: 'api/print-submit'
    };

    var cfReq = await createCfPrintRequest({
      kind: 'print_request',
      user_id: user,
      amount: amountLabel,
      coins: paidVia === 'fc' ? PRINT_FC_COST : 0,
      provider: paidVia,
      label: 'PRINT ' + orderCode,
      payload: requestPayload
    });

    var requestId = cfReq && cfReq.id ? String(cfReq.id) : '';
    var out = {
      ok: true,
      order_code: orderCode,
      request_id: requestId,
      status: 'submitted',
      payment_status: status,
      paid_via: paidVia,
      amount: amountLabel,
      photo_count: photos.length,
      user: user,
      fc: fcMeta
    };

    recentOrders.set(idem, out);
    setTimeout(function () { recentOrders.delete(idem); }, 15 * 60 * 1000);

    await notifyMastersan({
      order_code: orderCode,
      user: user,
      payment_label: paidVia === 'fc' ? (PRINT_FC_COST + ' FC') : 'Throne',
      photo_count: photos.length,
      request_id: requestId
    });

    return json(res, 200, out);
  } catch (e) {
    return json(res, 500, {
      ok: false,
      error: 'print_submit_failed',
      message: String((e && e.message) || e || 'error')
    });
  }
};
