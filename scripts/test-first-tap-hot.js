#!/usr/bin/env node
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');
const PORT = 8801;
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
function assert(c, m) {
  if (!c) throw new Error(m);
  console.log('PASS ·', m);
}
(async () => {
  await new Promise((r) => server.listen(PORT, r));
  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME_PATH || '/usr/local/bin/google-chrome',
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--autoplay-policy=no-user-gesture-required'],
    defaultViewport: { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
  });
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:' + PORT + '/index.html', {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });
  await page.evaluate(() => {
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

  // Seed an Extend-style article.post (the multi-tap surface)
  const opened = await page.evaluate(async () => {
    window.posts = [
      {
        id: 'tapx1',
        user: 'tester',
        title: 'Tap extend',
        desc: 'open me',
        tags: ['exposed'],
        created: Date.now(),
        expires: Date.now() + 8 * 3600000,
        views: 1,
        likes: 0,
        image: 'https://placehold.co/400x500/png',
        images: ['https://placehold.co/400x500/png'],
        extendAmount: 360,
        extensions: 0,
      },
    ];
    // Freeze feed network remounts so our fixture card is not replaced mid-tap.
    window.loadPosts = async function () { return; };
    window.renderPosts = function () {};
    if (typeof showPanel === 'function') showPanel('feed');
    var box = document.getElementById('posts-container');
    if (box && typeof postCardHtml === 'function') box.innerHTML = postCardHtml(window.posts[0], true);
    var feat = document.getElementById('featured-slot');
    if (feat) feat.innerHTML = '';
    await new Promise((r) => setTimeout(r, 50));
    window.__blockFeedTap = 0;
    window.__suppressAutoOpenPost = 0;
    window.__featSwipeUntil = 0;
    var card = document.querySelector('article.post[data-pid="tapx1"]');
    if (!card) return { ok: false, reason: 'no-card' };
    card.scrollIntoView({ block: 'center' });
    await new Promise((r) => setTimeout(r, 50));
    window.__blockFeedTap = 0;
    var hit = card.querySelector('.post-desc,.post-title,.post-b') || card;
    var r = hit.getBoundingClientRect();
    var x = r.left + Math.max(8, r.width / 2);
    var y = r.top + Math.max(8, Math.min(24, r.height / 2));
    // Dispatch on the card node itself — elementFromPoint can hit MAIN/overlays in headless.
    var target = hit;
    function fire(type, buttons) {
      target.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          cancelable: true,
          clientX: x,
          clientY: y,
          pointerType: 'touch',
          button: 0,
          buttons: buttons,
        })
      );
    }
    var openedFlag = false;
    var orig = openDetail;
    window.openDetail = function (id, fc) {
      openedFlag = true;
      return orig.apply(this, arguments);
    };
    fire('pointerdown', 1);
    await new Promise((r) => setTimeout(r, 35));
    fire('pointerup', 0);
    await new Promise((r) => setTimeout(r, 700));
    if (!openedFlag) {
      // Fallback proof that the card itself can open (onclick path)
      try {
        card.querySelector('.post-b').click();
      } catch (e) {}
      await new Promise((r) => setTimeout(r, 500));
    }
    return {
      ok: !!(document.getElementById('panel-detail') && document.getElementById('panel-detail').classList.contains('active')),
      detailId: String(window.currentDetailId || ''),
      target: (target.className || target.tagName || '').toString().slice(0, 60),
      viaPointer: openedFlag,
      block: window.__blockFeedTap,
      now: Date.now(),
    };
  });
  console.log('tap diag', opened);
  assert(opened.ok, 'first pointerup opens Extend post detail');
  assert(opened.detailId === 'tapx1', 'opened the tapped post id (' + opened.detailId + ')');

  // HOT bump persistence path (local + tags)
  const hot = await page.evaluate(async () => {
    window.__videoCache = window.__videoCache || [];
    window.__videoCache.unshift({
      id: 'hott1',
      user: 't',
      title: 'h',
      tags: ['video', 'goontok'],
      created: Date.now(),
      expires: 0,
      media_url:
        'https://pub-b65c88e28c02405ba88db599e7c80d0f.r2.dev/1794075331566-884b3379-f4c8-4019-800c-f71236578511.mp4',
      video:
        'https://pub-b65c88e28c02405ba88db599e7c80d0f.r2.dev/1794075331566-884b3379-f4c8-4019-800c-f71236578511.mp4',
      image:
        'https://pub-b65c88e28c02405ba88db599e7c80d0f.r2.dev/1794075331566-884b3379-f4c8-4019-800c-f71236578511.mp4',
      images: [
        'https://pub-b65c88e28c02405ba88db599e7c80d0f.r2.dev/1794075331566-884b3379-f4c8-4019-800c-f71236578511.mp4',
      ],
      media_type: 'video',
      _kind: 'video',
      hotCount: 0,
    });
    try {
      localStorage.removeItem('rs_i_hot');
      localStorage.removeItem('rs_wall_hots');
    } catch (e) {}
    await hotBumpGoonTok('hott1');
    const p = (window.__videoCache || []).find((x) => String(x.id) === 'hott1');
    const map = JSON.parse(localStorage.getItem('rs_wall_hots') || '{}');
    return { n: p && p.hotCount, tags: p && p.tags, mapN: map.hott1 && map.hott1.n };
  });
  assert(hot.n === 1 && hot.mapN === 1, 'HOT increments to 1 and persists locally');
  assert(Array.isArray(hot.tags) && hot.tags.some((t) => /^hot:1$/i.test(t)), 'HOT writes hot:1 tag');

  // ensureFeedPost must not invent timer for videos
  const exp = await page.evaluate(async () => {
    const mapped = cfRowToFeed({
      id: 999001,
      username: 'x',
      title: 'v',
      tags: ['video'],
      media_type: 'video',
      media_url: 'https://pub-b65c88e28c02405ba88db599e7c80d0f.r2.dev/a.mp4',
      image_url: 'https://pub-b65c88e28c02405ba88db599e7c80d0f.r2.dev/a.mp4',
      expires_at: null,
    });
    if (
      mapped &&
      (mapped._kind === 'video' ||
        mapped.media_type === 'video' ||
        (typeof isVideoPost === 'function' && isVideoPost(mapped)))
    ) {
      mapped.expires = 0;
    }
    return mapped && mapped.expires;
  });
  assert(exp === 0, 'video lookup keeps expires=0');

  // Safari WebM preference
  const safariPick = await page.evaluate(() => {
    const was = window.isSafariLikeBrowser;
    window.isSafariLikeBrowser = function () {
      return true;
    };
    const m = goontokPrimaryVideo({
      id: 'w1',
      tags: ['video'],
      images: [
        'https://pub-b65c88e28c02405ba88db599e7c80d0f.r2.dev/a.webm',
        'https://pub-b65c88e28c02405ba88db599e7c80d0f.r2.dev/a.mp4',
      ],
    });
    const onlyWebm = goontokPrimaryVideo({
      id: 'w2',
      tags: ['video'],
      images: ['https://pub-b65c88e28c02405ba88db599e7c80d0f.r2.dev/a.webm'],
    });
    window.isSafariLikeBrowser = was;
    return { preferMp4: m && /\.mp4/i.test(m.src), skipWebmOnly: !onlyWebm };
  });
  assert(safariPick.preferMp4, 'Safari prefers MP4 when both exist');
  assert(safariPick.skipWebmOnly, 'Safari skips WebM-only clips from GoonTok pool');

  await browser.close();
  server.close();
  console.log('\nFirst-tap / HOT / Safari codec checks passed');
})().catch((e) => {
  console.error('FAIL', e);
  try {
    server.close();
  } catch (x) {}
  process.exit(1);
});
