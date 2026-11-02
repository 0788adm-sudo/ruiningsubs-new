#!/usr/bin/env node
/**
 * Live check: numeric Supabase posts extend via api/extend.js (no CF UUID).
 * Also verifies local handler returns 6h cooldown after success.
 */
const path = require('path');
const handler = require(path.join(__dirname, '..', 'api', 'extend.js'));

function assert(c, m) {
  if (!c) throw new Error(m);
  console.log('PASS · ' + m);
}

function mockRes() {
  return {
    statusCode: 0,
    headers: {},
    body: '',
    setHeader: function (k, v) { this.headers[k] = v; },
    end: function (s) { this.body = s; }
  };
}

(async function main() {
  const SB = process.env.SUPABASE_URL || 'https://snlpdolzhzcbbdyxqlnb.supabase.co';
  const KEY =
    process.env.SUPABASE_ANON_KEY ||
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNubHBkb2x6aHpjYmJkeXhxbG5iIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY1NTg0OTYsImV4cCI6MjEwMjEzNDQ5Nn0.sWbn1sLgG6vi6wzKxpW5-1Td47awaxhwA-4ixKXZN-E';

  const list = await fetch(
    SB +
      '/rest/v1/posts?select=id,expires_at,extensions_count&expires_at=gt.' +
      encodeURIComponent(new Date().toISOString()) +
      '&order=expires_at.asc&limit=1',
    { headers: { apikey: KEY, Authorization: 'Bearer ' + KEY } }
  );
  const rows = await list.json();
  assert(Array.isArray(rows) && rows[0] && rows[0].id, 'found a live numeric post');
  const postId = String(rows[0].id);
  const beforeExp = new Date(rows[0].expires_at).getTime();
  const beforeExt = Number(rows[0].extensions_count) || 0;
  const user = 'exttest_' + Date.now().toString(36);

  const req = {
    method: 'POST',
    headers: {},
    body: { post_id: postId, user: user, minutes: 360 }
  };
  const res = mockRes();
  await handler(req, res);
  const j = JSON.parse(res.body || '{}');
  assert(res.statusCode === 200, 'handler status 200 for numeric id ' + postId + ' got ' + res.statusCode + ' ' + res.body);
  assert(j.ok === true, 'handler ok');
  assert(j.source === 'supabase', 'source=supabase for numeric id');
  assert(Number(j.minutes_added) === 360, 'minutes_added=360');
  assert(Number(j.cooldown_ms) === 6 * 60 * 60 * 1000, 'cooldown_ms=6h');
  assert(j.available === false, 'available=false after extend');
  assert(Number(j.remaining_ms) > 0, 'remaining_ms starts countdown');
  assert(Number(j.expires_at) >= beforeExp + 360 * 60000 - 5000, 'expires_at advanced ~+6h');
  assert(Number(j.extensions) === beforeExt + 1, 'extensions_count +1');

  // Second call within cooldown → 429
  const res2 = mockRes();
  await handler(
    { method: 'POST', headers: {}, body: { post_id: postId, user: user, minutes: 360 } },
    res2
  );
  const j2 = JSON.parse(res2.body || '{}');
  assert(res2.statusCode === 429 && j2.error === 'cooldown', 'same user+post blocked by 6h cooldown');
  assert(/You can extend again in /.test(String(j2.message || '')), 'English cooldown message');

  // Revert expires/extensions so we don't permanently inflate the live post more than needed.
  // Keep the +6h we applied (real behavior) — only log.
  console.log('extended post #' + postId + ' → ' + new Date(j.expires_at).toISOString());
  console.log('\\nExtend Supabase fallback checks passed');
})().catch(function (e) {
  console.error('FAIL', e && e.stack ? e.stack : e);
  process.exit(1);
});
