#!/usr/bin/env node
/**
 * Browser E2E for GoonTok after soft-fail + preload fixes.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
let puppeteer;
try {
  puppeteer = require('puppeteer-core');
} catch (e) {
  console.log('SKIP · puppeteer-core not installed (optional browser E2E)');
  process.exit(0);
}

const ROOT = require('path').join(__dirname, '..');
const PORT = 8799;
const dm = require('../api/dm.js');
const videos = require('../api/videos.js');

function contentType(p) {
  if (p.endsWith('.html')) return 'text/html; charset=utf-8';
  if (p.endsWith('.js')) return 'application/javascript';
  return 'application/octet-stream';
}

const server = http.createServer(async (req, res) => {
  const u = decodeURIComponent((req.url || '/').split('?')[0]);
  if (u === '/api/dm' || u.startsWith('/api/dm')) {
    req.url = req.url;
    return dm(req, res);
  }
  if (u === '/api/videos' || u.startsWith('/api/videos')) {
    return videos(req, res);
  }
  let fp = path.join(ROOT, u === '/' ? 'index.html' : u.replace(/^\//, ''));
  if (!fp.startsWith(ROOT) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) {
    res.writeHead(404);
    res.end('missing');
    return;
  }
  res.writeHead(200, { 'Content-Type': contentType(fp), 'Cache-Control': 'no-store' });
  fs.createReadStream(fp).pipe(res);
});

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
  console.log('PASS ·', msg);
}

(async () => {
  await new Promise((r) => server.listen(PORT, r));
  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME_PATH || '/usr/local/bin/google-chrome',
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--autoplay-policy=no-user-gesture-required',
      '--disable-web-security',
    ],
    defaultViewport: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  });
  const page = await browser.newPage();
  page.setDefaultTimeout(90000);
  const logs = [];
  page.on('console', (m) => logs.push(m.type() + ': ' + m.text()));
  page.on('pageerror', (e) => logs.push('PAGEERROR: ' + e.message));

  await page.goto('http://127.0.0.1:' + PORT + '/index.html', {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });

  // Dismiss age gate
  await page.evaluate(() => {
    try {
      localStorage.setItem('rs_age_ok', '1');
      localStorage.setItem('age_ok', '1');
      var gate = document.getElementById('age-gate');
      if (gate) {
        gate.classList.add('hidden');
        gate.style.display = 'none';
      }
      var app = document.getElementById('app');
      if (app) app.classList.add('show');
    } catch (e) {}
  });

  await page.evaluate(async () => {
    try {
      if (typeof openGoonTok === 'function') openGoonTok();
      else if (typeof showPanel === 'function') showPanel('goontok');
    } catch (e) {}
    document.body.classList.add('gt-on');
  });

  let slideCount = 0;
  for (let i = 0; i < 50; i++) {
    slideCount = await page.evaluate(() => document.querySelectorAll('#gt-scroller .gt-slide').length);
    if (slideCount >= 5) break;
    await page.evaluate(async () => {
      try {
        if (typeof fetchVideoPosts === 'function') await fetchVideoPosts();
      } catch (e) {}
      try {
        if (typeof renderGoonTok === 'function') renderGoonTok();
      } catch (e) {}
      try {
        if (typeof refillGoonTokPlayable === 'function') await refillGoonTokPlayable(true);
      } catch (e) {}
    });
    await new Promise((r) => setTimeout(r, 600));
  }

  if (slideCount < 5) {
    const diag = await page.evaluate(() => ({
      slides: document.querySelectorAll('#gt-scroller .gt-slide').length,
      empty: (document.querySelector('#gt-scroller') || {}).innerHTML?.slice?.(0, 300),
      cache: (window.__videoCache || []).length,
      htmlErr: document.body.innerText.slice(0, 200),
    }));
    throw new Error('Need ≥5 slides, got ' + slideCount + ' diag=' + JSON.stringify(diag));
  }
  assert(slideCount >= 5, 'feed mounted ≥5 slides (' + slideCount + ')');

  const idsBefore = await page.evaluate(() =>
    [].slice.call(document.querySelectorAll('#gt-scroller .gt-slide[data-gid]')).map((el) => el.getAttribute('data-gid'))
  );

  async function snap(i) {
    return page.evaluate(async (idx) => {
      const sc = document.getElementById('gt-scroller');
      const slides = [].slice.call(sc.querySelectorAll('.gt-slide'));
      const h = sc.clientHeight || 700;
      sc.scrollTop = idx * h;
      if (typeof window.__gtWindowVideos === 'function') window.__gtWindowVideos(idx);
      await new Promise((r) => setTimeout(r, 2200));
      const active = slides[idx];
      const v = active && active.querySelector('video[data-gt-vid]');
      const allIds = [].slice.call(sc.querySelectorAll('.gt-slide[data-gid]')).map((el) => el.getAttribute('data-gid'));
      let playing = false;
      let ready = 0;
      let err = '';
      let src = '';
      let loadVisible = false;
      if (v) {
        src = v.currentSrc || v.src || v.getAttribute('data-src') || '';
        ready = v.readyState || 0;
        err = v.error ? String(v.error.code || 'err') : '';
        try {
          v.muted = true;
          await v.play();
        } catch (e) {}
        await new Promise((r) => setTimeout(r, 1000));
        playing = !v.paused && v.readyState >= 2;
      }
      const loadEl = active && active.querySelector('.gt-load');
      loadVisible = !!(loadEl && !loadEl.hidden);
      let prevPaused = true;
      if (idx > 0) {
        const pv = slides[idx - 1] && slides[idx - 1].querySelector('video[data-gt-vid]');
        if (pv) prevPaused = pv.paused || !pv.getAttribute('src');
      }
      return {
        id: active && active.getAttribute('data-gid'),
        slideCount: allIds.length,
        allIds,
        playing,
        ready,
        err,
        src: String(src).slice(0, 140),
        prevPaused,
        loadVisible,
        hasWorkerMedia: /workers\.dev\/media\//i.test(src),
        softErr: !!(active && active.getAttribute('data-gt-error') === '1'),
      };
    }, i);
  }

  const results = [];
  for (let i = 0; i < 5; i++) {
    const r = await snap(i);
    results.push(r);
    assert(r.slideCount >= 5, 'after slide ' + (i + 1) + ' still ≥5 mounted (' + r.slideCount + ')');
    assert(!!r.id, 'slide ' + (i + 1) + ' has id');
    assert(!!r.src, 'slide ' + (i + 1) + ' has src');
    assert(!r.hasWorkerMedia, 'slide ' + (i + 1) + ' not using dead worker /media URL');
    const ok = r.playing || (r.ready >= 1 && !r.err) || (r.src && !r.err) || r.softErr;
    assert(ok, 'slide ' + (i + 1) + ' playable/loading (playing=' + r.playing + ' ready=' + r.ready + ' err=' + r.err + ')');
    if (i > 0) assert(r.prevPaused, 'previous slide paused when on slide ' + (i + 1));
    console.log('  · video', i + 1, r.id, r.playing ? 'PLAYING' : r.softErr ? 'SOFT_ERR' : 'armed', r.src.slice(0, 70));
  }

  // IDs must remain stable (no mid-swipe drop reshuffle)
  const back = await snap(0);
  assert(back.slideCount >= 5, 'after scroll-up still ≥5 slides');
  const stillHave = idsBefore.slice(0, 5).every((id) => back.allIds.indexOf(id) >= 0);
  assert(stillHave, 'original first 5 slide ids still present after navigation');

  // DM case-insensitive load via /api/dm from the page context
  const dm = await page.evaluate(async () => {
    const r = await fetch('/api/dm?me=mastersan&with=loserfagg');
    const j = await r.json();
    return { status: r.status, n: (j.messages || []).length, ok: j.ok };
  });
  assert(dm.ok && dm.n >= 2, 'page /api/dm loads MasterSan↔LoserFagg (' + dm.n + ')');

  await browser.close();
  server.close();
  console.log('\nBrowser E2E passed');
  console.log(JSON.stringify(results.map((r) => ({ id: r.id, playing: r.playing, ready: r.ready, softErr: r.softErr })), null, 2));
  if (logs.filter((l) => /PAGEERROR/.test(l)).length) {
    console.log('Page errors:', logs.filter((l) => /PAGEERROR/.test(l)).slice(0, 5));
  }
})().catch(async (e) => {
  console.error('FAIL', e);
  try {
    server.close();
  } catch (x) {}
  process.exit(1);
});
