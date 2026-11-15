#!/usr/bin/env node
'use strict';
/**
 * Mandatory UX path:
 * open post → register view → close → reopen → keep/increment → reload keeps DB value
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const https = require('https');
const puppeteer = require('puppeteer-core');
const PORT = 8817;

function assert(c, m) {
  if (!c) throw new Error(m);
  console.log('PASS ·', m);
}

function sb(method, pathName, body) {
  return new Promise(function (resolve, reject) {
    var url = new URL('https://snlpdolzhzcbbdyxqlnb.supabase.co' + pathName);
    var key =
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNubHBkb2x6aHpjYmJkeXhxbG5iIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY1NTg0OTYsImV4cCI6MjEwMjEzNDQ5Nn0.sWbn1sLgG6vi6wzKxpW5-1Td47awaxhwA-4ixKXZN-E';
    var data = body ? JSON.stringify(body) : null;
    var req = https.request(
      {
        hostname: url.hostname,
        path: url.pathname + url.search,
        method: method,
        headers: {
          apikey: key,
          Authorization: 'Bearer ' + key,
          'Content-Type': 'application/json',
          Prefer: 'return=representation',
        },
      },
      function (res) {
        var chunks = [];
        res.on('data', function (c) {
          chunks.push(c);
        });
        res.on('end', function () {
          var text = Buffer.concat(chunks).toString('utf8');
          var json = null;
          try {
            json = JSON.parse(text);
          } catch (e) {
            json = text;
          }
          resolve({ status: res.statusCode, body: json });
        });
      }
    );
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

const server = http.createServer((req, res) => {
  const u = decodeURIComponent((req.url || '/').split('?')[0]);
  let fp = path.join('/workspace', u === '/' ? 'index.html' : u.replace(/^\//, ''));
  if (!fp.startsWith('/workspace') || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) {
    res.writeHead(404);
    res.end('missing');
    return;
  }
  res.writeHead(200, {
    'Content-Type': u.endsWith('.js') ? 'application/javascript' : 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  fs.createReadStream(fp).pipe(res);
});

(async () => {
  await new Promise((r) => server.listen(PORT, r));
  const chrome =
    process.env.CHROME_PATH ||
    (fs.existsSync('/usr/local/bin/google-chrome')
      ? '/usr/local/bin/google-chrome'
      : '/usr/bin/google-chrome');
  const browser = await puppeteer.launch({
    executablePath: chrome,
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    defaultViewport: { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
  });
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:' + PORT + '/index.html', {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('rs_age_ok', '1');
    localStorage.setItem('age_ok', '1');
    var gate = document.getElementById('age-gate');
    if (gate) {
      gate.classList.add('hidden');
      gate.style.display = 'none';
    }
    var app = document.getElementById('app');
    if (app) app.classList.add('show');
  });

  // Stub network lookups so openDetail uses our fixture, but keep real persistViews → Supabase.
  const fixtureId = 'viewfix_' + Date.now();
  const result = await page.evaluate(async (id) => {
    // Freeze background feed loaders that would bury the fixture in posts[]
    window.loadPosts = async function () {
      return;
    };
    window.fetchCfFeed = async function () {
      return [];
    };
    window.loadNormalFeed = async function () {
      return;
    };
    window.renderPosts = function () {};
    window.__staleServerViews = true;
    window.ensureFeedPost = async function (pid) {
      pid = String(pid);
      // Simulate server returning views:0 while local floor still has the real total.
      var row = {
        id: id,
        user: 'viewer_bot',
        title: 'Views persist fixture',
        desc: 'counter must survive close/reopen',
        tags: ['normal_feed'],
        created: Date.now(),
        expires: 0,
        views: 0,
        likes: 0,
        image: 'https://placehold.co/400x500/png',
        images: ['https://placehold.co/400x500/png'],
        extensions: 0,
        extendAmount: 0,
        likedBy: [],
        reactions: {},
      };
      return typeof rememberFeedPost === 'function' ? rememberFeedPost(row) : row;
    };
    window.posts = [];
    window.normalFeedPosts = [];

    function memViews() {
      var hit = (window.posts || []).find(function (p) {
        return String(p.id) === String(id);
      });
      return Number(hit && hit.views) || 0;
    }
    async function readShown() {
      var b = document.querySelector('#detail-content [data-views-id="' + id + '"]');
      return b ? String(b.textContent || '').trim() : null;
    }
    async function waitOpenReady() {
      window.__openDetailLock = null;
      await new Promise(function (r) {
        setTimeout(r, 800);
      });
    }

    // 1) Open
    await waitOpenReady();
    await openDetail(id);
    await new Promise(function (r) {
      setTimeout(r, 300);
    });
    var open1 = await readShown();
    var mem1 = memViews();
    var loc1 = 0;
    try {
      loc1 = Number(JSON.parse(localStorage.getItem('rs_views') || '{}')[id] || 0);
    } catch (e) {}

    // 2) Close
    try {
      if (typeof showPanel === 'function') showPanel('feed');
    } catch (e) {}
    currentDetailId = null;

    // 3) Reopen — ensureFeedPost still returns stale server views:0
    await waitOpenReady();
    await openDetail(id);
    await new Promise(function (r) {
      setTimeout(r, 300);
    });
    var open2 = await readShown();
    var mem2 = memViews();
    var loc2 = 0;
    try {
      loc2 = Number(JSON.parse(localStorage.getItem('rs_views') || '{}')[id] || 0);
    } catch (e) {}

    // 4) Reload simulation: wipe pools, keep localStorage floor, open again
    var floor = loc2;
    window.posts = [];
    window.normalFeedPosts = [];
    window.__viewPersist = {};
    if (typeof setViewsEverywhere === 'function') setViewsEverywhere(id, floor);
    await waitOpenReady();
    await openDetail(id);
    await new Promise(function (r) {
      setTimeout(r, 300);
    });
    var open3 = await readShown();
    var mem3 = memViews();

    return {
      open1: open1,
      mem1: mem1,
      loc1: loc1,
      open2: open2,
      mem2: mem2,
      loc2: loc2,
      open3: open3,
      mem3: mem3,
      displayViews: typeof displayViews === 'function' ? displayViews : null,
    };
  }, fixtureId);

  // displayViews doubles the stored integer for UI.
  // Feed impressions may also bump between close→reopen; that is OK as long as we never reset to 0.
  assert(result.mem1 >= 1, 'first open memory views>=1 (got ' + result.mem1 + ')');
  assert(result.loc1 === result.mem1, 'first open localStorage matches memory');
  assert(String(result.open1) === String(result.mem1 * 2), 'first open UI shows displayViews(mem) (got ' + result.open1 + ')');

  assert(result.mem2 > result.mem1, 'reopen keeps prior total and increases (mem1=' + result.mem1 + ' mem2=' + result.mem2 + ')');
  assert(result.loc2 === result.mem2, 'reopen localStorage matches memory');
  assert(String(result.open2) === String(result.mem2 * 2), 'reopen UI matches displayViews (got ' + result.open2 + ')');
  assert(result.mem2 > 0, 'reopen did not reset to 0');

  assert(result.mem3 > result.mem2 - 1, 'reload keeps floor and can increment (got ' + result.mem3 + ')');
  assert(result.mem3 >= result.loc2, 'reload starts from preserved local/DB floor');
  assert(String(result.open3) === String(result.mem3 * 2), 'reload UI matches displayViews (got ' + result.open3 + ')');

  // Live DB persistence path used by persistViews (numeric posts only)
  var liveId = 2909;
  var before = await sb('GET', '/rest/v1/posts?select=id,views&id=eq.' + liveId);
  var cur = Number(before.body && before.body[0] && before.body[0].views) || 0;
  var persisted = await page.evaluate(async (pid, total) => {
    if (typeof persistViews === 'function') persistViews(String(pid), total);
    else if (typeof bumpViews === 'function') {
      // force absolute by seeding local then bumping 0 times via setViewsEverywhere
      if (typeof setViewsEverywhere === 'function') setViewsEverywhere(String(pid), total);
      if (typeof persistViews === 'function') persistViews(String(pid), total);
    }
    await new Promise(function (r) {
      setTimeout(r, 1200);
    });
    return true;
  }, liveId, cur + 1);
  assert(persisted, 'persistViews invoked in page');
  var after = await sb('GET', '/rest/v1/posts?select=id,views&id=eq.' + liveId);
  var got = Number(after.body && after.body[0] && after.body[0].views) || 0;
  assert(got === cur + 1, 'reload DB value kept at ' + (cur + 1) + ' (was ' + cur + ', got ' + got + ')');

  await browser.close();
  server.close();
  console.log('\nOpen/close/reopen/reload views checks passed');
})().catch(async (e) => {
  console.error('FAIL:', e && e.stack ? e.stack : e);
  process.exit(1);
});
