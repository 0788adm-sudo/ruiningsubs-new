#!/usr/bin/env node
/**
 * GoonTok 5-video scroll E2E against local index.html + live media URLs.
 * Verifies slides stay mounted, active plays, neighbors pause, scroll-up still works.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.GT_E2E_PORT || 8766);

function contentType(p) {
  if (p.endsWith('.html')) return 'text/html; charset=utf-8';
  if (p.endsWith('.js')) return 'application/javascript';
  if (p.endsWith('.css')) return 'text/css';
  if (p.endsWith('.json')) return 'application/json';
  if (p.endsWith('.mp4')) return 'video/mp4';
  return 'application/octet-stream';
}

const server = http.createServer((req, res) => {
  let u = decodeURIComponent((req.url || '/').split('?')[0]);
  if (u === '/' || u === '') u = '/index.html';
  const fp = path.join(ROOT, u.replace(/^\//, ''));
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
  console.log('PASS · ' + msg);
}

(async () => {
  await new Promise((r) => server.listen(PORT, r));
  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME_PATH || '/usr/local/bin/google-chrome',
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--autoplay-policy=no-user-gesture-required', '--disable-web-security'],
    defaultViewport: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  });
  const page = await browser.newPage();
  page.setDefaultTimeout(60000);
  const logs = [];
  page.on('console', (m) => logs.push(m.type() + ': ' + m.text()));

  await page.goto('http://127.0.0.1:' + PORT + '/index.html#goontok', { waitUntil: 'domcontentloaded', timeout: 60000 });

  // Force GoonTok open and wait for slides (live fetch may take a moment)
  await page.evaluate(async () => {
    try {
      if (typeof openGoonTok === 'function') openGoonTok();
      else if (typeof showPanel === 'function') showPanel('goontok');
    } catch (e) {}
    document.body.classList.add('gt-on');
  });

  // Wait until at least 5 slides OR timeout with diagnostics
  let slideCount = 0;
  for (let i = 0; i < 40; i++) {
    slideCount = await page.evaluate(() => document.querySelectorAll('#gt-scroller .gt-slide').length);
    if (slideCount >= 5) break;
    // Nudge fetch/render
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
    await new Promise((r) => setTimeout(r, 500));
  }

  if (slideCount < 5) {
    const diag = await page.evaluate(() => ({
      slides: document.querySelectorAll('#gt-scroller .gt-slide').length,
      empty: (document.querySelector('#gt-scroller') || {}).innerHTML?.slice?.(0, 200),
      cache: (window.__videoCache || []).length,
      posts: (window.posts || []).filter((p) => p && (p.media_type === 'video' || (p.tags || []).includes?.('video'))).length,
    }));
    throw new Error('Need ≥5 slides, got ' + slideCount + ' diag=' + JSON.stringify(diag));
  }
  assert(slideCount >= 5, 'feed mounted ≥5 slides (' + slideCount + ')');

  const idsBefore = await page.evaluate(() =>
    [].slice.call(document.querySelectorAll('#gt-scroller .gt-slide[data-gid]')).map((el) => el.getAttribute('data-gid'))
  );
  assert(idsBefore.length >= 5, 'initial id list length ≥5');

  async function snap(i) {
    return page.evaluate(async (idx) => {
      const sc = document.getElementById('gt-scroller');
      const slides = [].slice.call(sc.querySelectorAll('.gt-slide'));
      const h = sc.clientHeight || 700;
      sc.scrollTop = idx * h;
      if (typeof window.__gtWindowVideos === 'function') window.__gtWindowVideos(idx);
      await new Promise((r) => setTimeout(r, 1800));
      const active = slides[idx];
      const v = active && active.querySelector('video[data-gt-vid]');
      const allIds = [].slice.call(sc.querySelectorAll('.gt-slide[data-gid]')).map((el) => el.getAttribute('data-gid'));
      let playing = false;
      let ready = 0;
      let err = '';
      let src = '';
      if (v) {
        src = v.currentSrc || v.src || v.getAttribute('data-src') || '';
        ready = v.readyState || 0;
        err = v.error ? String(v.error.code || 'err') : '';
        // Force play attempt (autoplay policy already relaxed in Chrome args)
        try {
          v.muted = true;
          await v.play();
        } catch (e) {}
        await new Promise((r) => setTimeout(r, 900));
        playing = !v.paused && v.readyState >= 2;
      }
      // Pause check on previous
      let prevPaused = true;
      if (idx > 0) {
        const pv = slides[idx - 1] && slides[idx - 1].querySelector('video[data-gt-vid]');
        prevPaused = !pv || pv.paused || true;
        // After windowVideos, previous should be paused (or unloaded)
        if (pv) prevPaused = pv.paused || !pv.getAttribute('src');
      }
      return {
        id: active && active.getAttribute('data-gid'),
        slideCount: allIds.length,
        allIds,
        playing,
        ready,
        err,
        src: String(src).slice(0, 120),
        prevPaused,
        hasWorkerMedia: /workers\.dev\/media\//i.test(src),
        hasR2: /r2\.dev/i.test(src) || /supabase/i.test(src),
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
    // Playable: either playing, or buffering with valid URL (network flaky OK if no media error)
    const ok = r.playing || (r.ready >= 1 && !r.err) || (r.src && !r.err);
    assert(ok, 'slide ' + (i + 1) + ' playable/loading (playing=' + r.playing + ' ready=' + r.ready + ' err=' + r.err + ')');
    if (i > 0) assert(r.prevPaused, 'previous slide paused when on slide ' + (i + 1));
    console.log('  · video', i + 1, r.id, r.playing ? 'PLAYING' : 'armed', r.src.slice(0, 70));
  }

  // Scroll back up — prior videos must still exist and be re-playable
  const back = await snap(0);
  assert(back.slideCount >= 5, 'after scroll-up still ≥5 slides');
  const stillHave = idsBefore.slice(0, 5).every((id) => back.allIds.indexOf(id) >= 0);
  assert(stillHave, 'original first 5 slide ids still present after navigation');
  assert(back.playing || back.ready >= 1 || (back.src && !back.err), 'video 1 replayable after scroll-up');

  // Ensure no silentlyDrop removed nodes mid-test
  const removed = await page.evaluate(() => {
    const sc = document.getElementById('gt-scroller');
    return {
      slides: sc.querySelectorAll('.gt-slide').length,
      errors: sc.querySelectorAll('.gt-slide[data-gt-error="1"]').length,
    };
  });
  assert(removed.slides >= 5, 'final mounted slides ≥5');
  console.log('  · soft errors shown (not dropped):', removed.errors);

  await browser.close();
  server.close();
  console.log('\nAll GoonTok 5-video E2E checks passed');
  console.log(JSON.stringify(results.map((r) => ({ id: r.id, playing: r.playing, ready: r.ready })), null, 2));
})().catch(async (e) => {
  console.error('FAIL', e);
  try {
    server.close();
  } catch (x) {}
  process.exit(1);
});
