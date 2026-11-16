/**
 * Persistent anonymous visitor identity.
 *
 * GET|POST /api/anon-identity
 * - Mints or returns anonymous_user_id
 * - Sets HttpOnly cookie rs_anon_id (1 year)
 * - Accepts optional body/query anon_id to resume the same visitor
 * - POST { action:'link', registered_user } records anon→registered link (best-effort)
 *
 * Does NOT grant delete rights. Anonymous accounts may play and publish only.
 */
const crypto = require('crypto');

const COOKIE = 'rs_anon_id';
const MAX_AGE = 60 * 60 * 24 * 365; // 1 year
const CF_API = process.env.CF_API || 'https://ruiningsubs-api.0788adm.workers.dev';
const SITE = process.env.SITE_URL || 'https://www.ruinexpose.com';
const BOARD_LINKS = '__ANON_LINKS__';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store'
};

function json(res, status, body, extraHeaders) {
  res.statusCode = status;
  Object.entries(cors).forEach(([k, v]) => res.setHeader(k, v));
  if (extraHeaders) {
    Object.entries(extraHeaders).forEach(([k, v]) => {
      if (k.toLowerCase() === 'set-cookie') res.setHeader('Set-Cookie', v);
      else res.setHeader(k, v);
    });
  }
  res.end(JSON.stringify(body));
}

function parseCookies(req) {
  const raw = String((req.headers && (req.headers.cookie || req.headers.Cookie)) || '');
  const out = {};
  raw.split(';').forEach((part) => {
    const i = part.indexOf('=');
    if (i < 0) return;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k) out[k] = decodeURIComponent(v || '');
  });
  return out;
}

function sanitizeAnonId(v) {
  return String(v || '')
    .replace(/[^a-zA-Z0-9_-]/g, '')
    .slice(0, 48);
}

function mintAnonId() {
  return 'a' + Date.now().toString(36) + crypto.randomBytes(8).toString('hex');
}

function isValidAnonId(id) {
  id = sanitizeAnonId(id);
  return id.length >= 8 && id.length <= 48;
}

function cookieHeader(id, secure) {
  const parts = [
    COOKIE + '=' + encodeURIComponent(id),
    'Path=/',
    'Max-Age=' + MAX_AGE,
    'HttpOnly',
    'SameSite=Lax'
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

function readBody(req) {
  return new Promise((resolve) => {
    if (req.body && typeof req.body === 'object') return resolve(req.body);
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch (_) {
        resolve({});
      }
    });
    req.on('error', () => resolve({}));
  });
}

async function cfPostLink(anonId, registeredUser) {
  try {
    await fetch(CF_API + '/notifs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: SITE },
      body: JSON.stringify({
        to_username: BOARD_LINKS,
        from_username: String(registeredUser || '').slice(0, 40),
        type: 'anon_link',
        post_id: String(anonId || ''),
        message: JSON.stringify({
          anonymous_user_id: anonId,
          registered_user: registeredUser,
          at: Date.now()
        })
      })
    });
  } catch (_) {}
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return json(res, 204, {});
  if (req.method !== 'GET' && req.method !== 'POST') {
    return json(res, 405, { error: 'method_not_allowed' });
  }

  const cookies = parseCookies(req);
  let body = {};
  if (req.method === 'POST') body = await readBody(req);

  const q = req.query || {};
  const fromCookie = sanitizeAnonId(cookies[COOKIE]);
  const fromClient = sanitizeAnonId(
    body.anon_id || body.anonId || body.anonymous_user_id || q.anon_id || q.anonId || ''
  );

  let id = '';
  if (isValidAnonId(fromCookie)) id = fromCookie;
  else if (isValidAnonId(fromClient)) id = fromClient;
  else id = mintAnonId();

  const secure =
    String((req.headers && (req.headers['x-forwarded-proto'] || req.headers['X-Forwarded-Proto'])) || '')
      .toLowerCase()
      .indexOf('https') === 0 ||
    String(process.env.VERCEL || '') === '1';

  const action = String(body.action || q.action || '').toLowerCase();
  if (action === 'link') {
    const registered = String(body.registered_user || body.user || body.username || '')
      .replace(/^@/, '')
      .replace(/[^a-zA-Z0-9_]/g, '')
      .slice(0, 40);
    if (!registered || /^anon_/i.test(registered) || /^Anon_/i.test(registered)) {
      return json(res, 400, { error: 'invalid_registered_user' }, { 'Set-Cookie': cookieHeader(id, secure) });
    }
    await cfPostLink(id, registered);
    return json(
      res,
      200,
      {
        ok: true,
        anonymous_user_id: id,
        account_type: 'anonymous',
        linked_to: registered,
        username: 'anon_' + id
      },
      { 'Set-Cookie': cookieHeader(id, secure) }
    );
  }

  return json(
    res,
    200,
    {
      ok: true,
      anonymous_user_id: id,
      account_type: 'anonymous',
      username: 'anon_' + id,
      created: !(isValidAnonId(fromCookie) || isValidAnonId(fromClient))
    },
    { 'Set-Cookie': cookieHeader(id, secure) }
  );
};
