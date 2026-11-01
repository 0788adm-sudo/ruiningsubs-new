#!/usr/bin/env node
// Local unit-style tests for api/print-submit.js (no Vercel runtime required).
const handler = require('../api/print-submit.js');

function mockReq(body, headers) {
  return {
    method: 'POST',
    headers: headers || {},
    body: body
  };
}
function mockRes() {
  const r = { statusCode: 0, headers: {}, body: '' };
  r.setHeader = function (k, v) { r.headers[k] = v; };
  r.end = function (b) { r.body = b || ''; };
  return r;
}
async function call(body, headers) {
  const res = mockRes();
  await handler(mockReq(body, headers), res);
  let json = {};
  try { json = JSON.parse(res.body || '{}'); } catch (e) {}
  return { status: res.statusCode, json: json };
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

(async function () {
  const results = [];
  function log(name, ok, detail) {
    results.push({ name: name, ok: !!ok, detail: detail || '' });
    console.log((ok ? 'PASS' : 'FAIL') + ' · ' + name + (detail ? ' · ' + detail : ''));
  }

  // TEST 1-3 style: no payment
  {
    const r = await call({
      order_code: 'PR-TEST01',
      user: 'tester',
      name: 'tester',
      photos: ['https://pub-b65c88e28c02405ba88db599e7c80d0f.r2.dev/x.jpg'],
      payment_method: ''
    });
    log('TEST unpaid 1 photo rejected', r.status === 402 && r.json.error === 'payment_required', r.status + ' ' + r.json.error);
  }
  {
    const r = await call({
      order_code: 'PR-TEST02',
      user: 'tester',
      photos: [
        'https://pub-b65c88e28c02405ba88db599e7c80d0f.r2.dev/a.jpg',
        'https://pub-b65c88e28c02405ba88db599e7c80d0f.r2.dev/b.jpg'
      ],
      payment_method: 'none'
    });
    log('TEST unpaid 2 photos rejected', r.status === 402, r.status + ' ' + r.json.error);
  }
  {
    const r = await call({
      order_code: 'PR-TEST03',
      user: 'tester',
      photos: [
        'https://pub-b65c88e28c02405ba88db599e7c80d0f.r2.dev/1.jpg',
        'https://pub-b65c88e28c02405ba88db599e7c80d0f.r2.dev/2.jpg',
        'https://pub-b65c88e28c02405ba88db599e7c80d0f.r2.dev/3.jpg',
        'https://pub-b65c88e28c02405ba88db599e7c80d0f.r2.dev/4.jpg',
        'https://pub-b65c88e28c02405ba88db599e7c80d0f.r2.dev/5.jpg'
      ]
    });
    log('TEST unpaid 5 photos rejected', r.status === 402, r.status + ' ' + r.json.error);
  }

  // TEST 8: 6 photos
  {
    const photos = [];
    for (var i = 0; i < 6; i++) photos.push('https://pub-b65c88e28c02405ba88db599e7c80d0f.r2.dev/' + i + '.jpg');
    const r = await call({
      order_code: 'PR-TEST08',
      user: 'tester',
      photos: photos,
      payment_method: 'throne',
      payment_proof: 'https://pub-b65c88e28c02405ba88db599e7c80d0f.r2.dev/proof.jpg'
    });
    log('TEST 6 photos rejected', r.status === 400 && r.json.error === 'invalid_photo_count', r.status + ' ' + r.json.error);
  }

  // Throne without proof
  {
    const r = await call({
      order_code: 'PR-TESTT1',
      user: 'tester',
      photos: ['https://pub-b65c88e28c02405ba88db599e7c80d0f.r2.dev/a.jpg'],
      payment_method: 'throne'
    });
    log('TEST throne without screenshot rejected', r.status === 402 && r.json.error === 'payment_proof_required', r.json.error);
  }

  // Throne with proof (real network create)
  {
    const code = 'PR-T' + Date.now().toString(36).toUpperCase().slice(-6);
    const r = await call({
      order_code: code,
      user: 'tester_throne',
      name: 'tester_throne',
      photos: ['https://pub-b65c88e28c02405ba88db599e7c80d0f.r2.dev/1791024065581-490a1b89-ba24-47b5-bace-cd470489d119.jpg'],
      payment_method: 'throne',
      payment_proof: 'https://pub-b65c88e28c02405ba88db599e7c80d0f.r2.dev/1791024065581-490a1b89-ba24-47b5-bace-cd470489d119.jpg'
    });
    log('TEST 1 photo + throne proof accepted', r.status === 200 && r.json.ok === true, JSON.stringify({ id: r.json.request_id, code: r.json.order_code, via: r.json.paid_via }));

    // idempotency
    const r2 = await call({
      order_code: code,
      user: 'tester_throne',
      photos: ['https://pub-b65c88e28c02405ba88db599e7c80d0f.r2.dev/1791024065581-490a1b89-ba24-47b5-bace-cd470489d119.jpg'],
      payment_method: 'throne',
      payment_proof: 'https://pub-b65c88e28c02405ba88db599e7c80d0f.r2.dev/1791024065581-490a1b89-ba24-47b5-bace-cd470489d119.jpg'
    }, { 'idempotency-key': code });
    log('TEST double submit deduped', r2.status === 200 && r2.json.deduped === true, 'deduped=' + r2.json.deduped);
  }

  // FC with zero balance user
  {
    const code = 'PR-F' + Date.now().toString(36).toUpperCase().slice(-6);
    const r = await call({
      order_code: code,
      user: 'zero_balance_user_xyz',
      photos: ['https://pub-b65c88e28c02405ba88db599e7c80d0f.r2.dev/1791024065581-490a1b89-ba24-47b5-bace-cd470489d119.jpg'],
      payment_method: 'fc'
    });
    log('TEST FC insufficient rejected', r.status === 402 && /insufficient|fc_payment/i.test(String(r.json.error || '')), r.json.error);
  }

  // Direct CF bypass still works today (documents Worker hole) — we assert awareness
  {
    const CF = 'https://ruiningsubs-api.0788adm.workers.dev';
    const r = await fetch(CF + '/requests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        kind: 'print_request',
        user_id: 'bypass_probe2',
        amount: '$40',
        coins: 0,
        provider: 'manual',
        label: 'PRINT bypass probe2',
        payload: { photos: ['https://example.com/a.jpg'], paid_via: 'manual' }
      })
    });
    const j = await r.json();
    log('TEST direct CF still accepts unpaid (Worker patch still required)', j && j.ok === true, 'id=' + (j.request && j.request.id));
  }

  // GoonTok: supabase probe video exists and is video URL
  {
    const KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNubHBkb2x6aHpjYmJkeXhxbG5iIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY1NTg0OTYsImV4cCI6MjEwMjEzNDQ5Nn0.sWbn1sLgG6vi6wzKxpW5-1Td47awaxhwA-4ixKXZN-E';
    const r = await fetch('https://snlpdolzhzcbbdyxqlnb.supabase.co/rest/v1/posts?username=eq.goontok_probe&select=id,image_url,tags&limit=1', {
      headers: { apikey: KEY, Authorization: 'Bearer ' + KEY }
    });
    const rows = await r.json();
    const ok = rows && rows[0] && /\.mp4/i.test(String(rows[0].image_url || ''));
    log('TEST goontok probe video in Supabase', ok, rows && rows[0] && rows[0].id);

    const head = await fetch(String(rows[0].image_url), { method: 'HEAD' });
    log('TEST goontok video URL reachable', head.ok || head.status === 200, 'http ' + head.status + ' ' + head.headers.get('content-type'));
  }

  // CF posts create still broken
  {
    const CF = 'https://ruiningsubs-api.0788adm.workers.dev';
    const r = await fetch(CF + '/posts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'x',
        title: 't',
        description: '',
        tags: ['video'],
        media_url: 'https://example.com/a.mp4',
        media_type: 'video'
      })
    });
    const j = await r.json();
    log('TEST CF POST /posts still schema-broken (fallback path needed)', !!(j && /16 values for 18 columns/i.test(String(j.error || ''))), j.error);
  }

  const failed = results.filter(function (x) { return !x.ok; });
  console.log('\n' + (results.length - failed.length) + '/' + results.length + ' passed');
  if (failed.length) process.exit(1);
})().catch(function (e) {
  console.error(e);
  process.exit(1);
});
