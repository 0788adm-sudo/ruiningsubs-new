// Reliable DM proxy — case-insensitive Supabase reads/writes with hard timeouts.
// Keeps Cloudflare comments as an optional mirror; never blocks the thread paint.

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://snlpdolzhzcbbdyxqlnb.supabase.co';
const SUPABASE_ANON =
  process.env.SUPABASE_ANON_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNubHBkb2x6aHpjYmJkeXhxbG5iIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY1NTg0OTYsImV4cCI6MjEwMjEzNDQ5Nn0.sWbn1sLgG6vi6wzKxpW5-1Td47awaxhwA-4ixKXZN-E';
const CF_API = process.env.CF_API || 'https://ruiningsubs-api.0788adm.workers.dev';

function json(res, code, body) {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.end(JSON.stringify(body));
}

function cleanUser(u) {
  return String(u || '')
    .replace(/^@/, '')
    .trim();
}

function dmThreadId(a, b) {
  return (
    '__dm_' +
    [cleanUser(a), cleanUser(b)]
      .map(function (x) {
        return x.toLowerCase();
      })
      .sort()
      .join('__')
  );
}

function readBody(req) {
  return new Promise(function (resolve, reject) {
    var chunks = [];
    req.on('data', function (c) {
      chunks.push(c);
    });
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

async function sbFetch(path, opts, ms) {
  opts = opts || {};
  ms = Number(ms) || 8000;
  var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  var timer = ctrl
    ? setTimeout(function () {
        try {
          ctrl.abort();
        } catch (e) {}
      }, ms)
    : null;
  try {
    var r = await fetch(SUPABASE_URL + path, {
      method: opts.method || 'GET',
      headers: Object.assign(
        {
          apikey: SUPABASE_ANON,
          Authorization: 'Bearer ' + SUPABASE_ANON,
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Prefer: opts.prefer || 'return=representation',
        },
        opts.headers || {}
      ),
      body: opts.body || undefined,
      signal: ctrl ? ctrl.signal : undefined,
    });
    var text = await r.text();
    var data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch (e) {
      data = { raw: text };
    }
    return { ok: r.ok, status: r.status, data: data };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function fetchThread(me, other) {
  me = cleanUser(me);
  other = cleanUser(other);
  if (!me || !other) return { messages: [], error: 'missing_users' };

  var q1 =
    '/rest/v1/messages?select=id,from_user,to_user,body,image_url,created_at,read' +
    '&from_user=ilike.' +
    encodeURIComponent(me) +
    '&to_user=ilike.' +
    encodeURIComponent(other) +
    '&order=created_at.asc&limit=200';
  var q2 =
    '/rest/v1/messages?select=id,from_user,to_user,body,image_url,created_at,read' +
    '&from_user=ilike.' +
    encodeURIComponent(other) +
    '&to_user=ilike.' +
    encodeURIComponent(me) +
    '&order=created_at.asc&limit=200';

  var pair = await Promise.all([sbFetch(q1, {}, 7000), sbFetch(q2, {}, 7000)]);
  var rows = []
    .concat((pair[0].ok && Array.isArray(pair[0].data) ? pair[0].data : []) || [])
    .concat((pair[1].ok && Array.isArray(pair[1].data) ? pair[1].data : []) || []);

  // Optional CF mirror (short timeout — never required)
  var threadKey = dmThreadId(me, other);
  try {
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var to = ctrl
      ? setTimeout(function () {
          try {
            ctrl.abort();
          } catch (e) {}
        }, 2500)
      : null;
    var cr = await fetch(CF_API + '/posts/' + encodeURIComponent(threadKey) + '/comments', {
      cache: 'no-store',
      signal: ctrl ? ctrl.signal : undefined,
    });
    if (to) clearTimeout(to);
    if (cr.ok) {
      var cj = await cr.json().catch(function () {
        return {};
      });
      var extra = (cj && (cj.comments || cj.data || cj)) || [];
      if (Array.isArray(extra)) {
        extra.forEach(function (m) {
          rows.push({
            from_user: m.username,
            to_user: other,
            body: m.text || m.body || '',
            created_at: m.created_at,
          });
        });
      }
    }
  } catch (e) {}

  var seen = {};
  rows = rows
    .filter(function (m) {
      return m && (m.body || m.text);
    })
    .sort(function (a, b) {
      return new Date(a.created_at || 0) - new Date(b.created_at || 0);
    })
    .filter(function (m) {
      var body = String(m.body || m.text || '');
      var k = String(m.from_user || m.username || '') + '|' + body + '|' + String(m.created_at || '');
      if (seen[k]) return false;
      seen[k] = 1;
      return true;
    });

  return { messages: rows, thread: threadKey, count: rows.length };
}

async function fetchInbox(me) {
  me = cleanUser(me);
  if (!me) return { conversations: [] };
  var q1 =
    '/rest/v1/messages?select=id,from_user,to_user,body,created_at' +
    '&from_user=ilike.' +
    encodeURIComponent(me) +
    '&order=created_at.desc&limit=80';
  var q2 =
    '/rest/v1/messages?select=id,from_user,to_user,body,created_at' +
    '&to_user=ilike.' +
    encodeURIComponent(me) +
    '&order=created_at.desc&limit=80';
  var pair = await Promise.all([sbFetch(q1, {}, 7000), sbFetch(q2, {}, 7000)]);
  var rows = []
    .concat((pair[0].ok && Array.isArray(pair[0].data) ? pair[0].data : []) || [])
    .concat((pair[1].ok && Array.isArray(pair[1].data) ? pair[1].data : []) || []);
  rows.sort(function (a, b) {
    return new Date(b.created_at || 0) - new Date(a.created_at || 0);
  });
  var map = {};
  var meLow = me.toLowerCase();
  rows.forEach(function (m) {
    var a = String(m.from_user || '');
    var b = String(m.to_user || '');
    var other = a.toLowerCase() === meLow ? b : a;
    if (!other) return;
    var key = other.toLowerCase();
    if (!map[key]) map[key] = { user: other, last: m };
  });
  return {
    conversations: Object.keys(map).map(function (k) {
      return map[k];
    }),
  };
}

async function sendMessage(me, other, body) {
  me = cleanUser(me);
  other = cleanUser(other);
  body = String(body || '').trim();
  if (!me || !other || !body) return { ok: false, error: 'missing_fields' };
  if (body.length > 2000) return { ok: false, error: 'too_long' };

  var ins = await sbFetch(
    '/rest/v1/messages',
    {
      method: 'POST',
      body: JSON.stringify({
        from_user: me,
        to_user: other,
        body: body,
        image_url: null,
      }),
    },
    8000
  );

  // Fire-and-forget CF mirror
  try {
    var threadKey = dmThreadId(me, other);
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var to = ctrl
      ? setTimeout(function () {
          try {
            ctrl.abort();
          } catch (e) {}
        }, 3000)
      : null;
    fetch(CF_API + '/posts/' + encodeURIComponent(threadKey) + '/comments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: me, text: body }),
      signal: ctrl ? ctrl.signal : undefined,
    }).catch(function () {});
    if (to) clearTimeout(to);
  } catch (e) {}

  if (!ins.ok) {
    return { ok: false, error: 'insert_failed', status: ins.status, detail: ins.data };
  }
  var row = Array.isArray(ins.data) ? ins.data[0] : ins.data;
  return { ok: true, message: row };
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return json(res, 204, {});

  try {
    if (req.method === 'GET') {
      var url = new URL(req.url, 'http://localhost');
      var me = cleanUser(url.searchParams.get('me') || url.searchParams.get('user'));
      var other = cleanUser(url.searchParams.get('with') || url.searchParams.get('other'));
      if (other) {
        var thread = await fetchThread(me, other);
        return json(res, 200, Object.assign({ ok: true }, thread));
      }
      var inbox = await fetchInbox(me);
      return json(res, 200, Object.assign({ ok: true }, inbox));
    }

    if (req.method === 'POST') {
      var body = await readBody(req);
      var action = String(body.action || 'send');
      if (action === 'send') {
        var out = await sendMessage(body.from || body.me, body.to || body.with, body.body || body.text);
        return json(res, out.ok ? 200 : 400, out);
      }
      if (action === 'thread') {
        var t = await fetchThread(body.from || body.me, body.to || body.with);
        return json(res, 200, Object.assign({ ok: true }, t));
      }
      return json(res, 400, { ok: false, error: 'unknown_action' });
    }

    return json(res, 405, { error: 'method_not_allowed' });
  } catch (e) {
    return json(res, 500, {
      ok: false,
      error: 'dm_failed',
      message: String(e && e.message ? e.message : e),
    });
  }
};
