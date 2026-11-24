#!/usr/bin/env node
'use strict';
/**
 * Static + browser checks for the official RUINEXPOSE Telegram GROUP invitation.
 * Keeps the existing channel popup intact and verifies independent timing/state.
 */
var fs = require('fs');
var path = require('path');
var http = require('http');
var html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

function assert(c, m) {
  if (!c) {
    console.error('FAIL · ' + m);
    process.exit(1);
  }
  console.log('PASS · ' + m);
}

/* —— Static structure / exact copy —— */
assert(html.includes('id="modal-tg-group"'), 'group modal markup exists');
assert(html.includes('id="modal-tg"'), 'channel modal kept');
assert(html.includes('https://t.me/ruiningsubscom'), 'channel invite URL kept');
assert(html.includes('https://t.me/ruinexpose'), 'group invite URL');
assert(html.includes('id="tg-group-join"'), 'JOIN NOW control');
assert(/JOIN NOW/.test(html), 'JOIN NOW label');
assert(html.includes('THE OFFICIAL') && html.includes('RUINEXPOSE') && html.includes('GROUP'), 'group title present');
assert(html.includes('Join the community. Participate. Explore different themes.'), 'exact body line 1');
assert(html.includes('Stop lurking. Get involved. Know your place.'), 'exact body line 2');
assert(html.includes('👑') || html.includes('tg-group-crown'), 'crown branding');
assert(html.includes('function setupTgGroupPopup'), 'setupTgGroupPopup exists');
assert(html.includes('function startTgGroupActiveWatch'), 'active watch starter');
assert(html.includes('function onTelegramChannelClosed'), 'channel-close hook');
assert(html.includes('function armTgGroupAfterChannelDecision'), 'arms when channel skipped');
assert(html.includes("TG_GROUP_HIDE_KEY='rs_tg_group_hide_v1'") || html.includes('rs_tg_group_hide_v1'), 'permanent hide key');
assert(html.includes('__tgGroupDismissCount'), 'session dismiss counter');
assert(html.includes('tgGroupPageActive') || html.includes('document.hidden'), 'active browsing / visibility pause');
assert(html.includes('visibilitychange'), 'visibility listener for pause');
assert(html.includes('tgGroupChannelVisible'), 'never overlap channel check');
assert(html.includes('armTgGroupAfterChannelDecision'), 'wired after maybeShowTelegram');
assert(html.includes('setupTgGroupPopup()'), 'setup called from setupUI');
assert(html.includes('onTelegramChannelClosed()'), 'channel close notifies group timer');
assert(html.includes('__TG_GROUP_FIRST_MS') && html.includes('__TG_GROUP_RETRY_MS'), 'testable timing overrides');
assert(html.includes('60000') && html.includes('300000'), '1 min first / 5 min retry defaults');
// Channel invitation must remain unchanged in substance
assert(html.includes('function maybeShowTelegram'), 'channel maybeShow kept');
assert(html.includes('function setupTelegramPopup'), 'channel setup kept');
assert(html.includes("TG_HIDE_KEY='rs_tg_hide_v2'") || html.includes('rs_tg_hide_v2'), 'channel hide key untouched');
assert(html.includes('id="tg-join"'), 'channel Join CTA kept');
assert(html.includes('Join the channel'), 'channel copy kept');

console.log('\nStatic group-popup checks passed');

/* —— Browser sequence (accelerated timers) —— */
var puppeteer;
try {
  puppeteer = require('puppeteer-core');
} catch (e) {
  console.log('SKIP · puppeteer-core not installed (static checks only)');
  process.exit(0);
}

var PORT = 8827;
var root = path.join(__dirname, '..');
var server = http.createServer(function (req, res) {
  var u = decodeURIComponent((req.url || '/').split('?')[0]);
  var fp = path.join(root, u === '/' ? 'index.html' : u.replace(/^\//, ''));
  if (!fp.startsWith(root) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) {
    res.writeHead(404);
    res.end('missing');
    return;
  }
  res.writeHead(200, {
    'Content-Type': u.endsWith('.js')
      ? 'application/javascript'
      : u.endsWith('.css')
        ? 'text/css'
        : 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  fs.createReadStream(fp).pipe(res);
});

function sleep(ms) {
  return new Promise(function (r) {
    setTimeout(r, ms);
  });
}

(async function () {
  await new Promise(function (r) {
    server.listen(PORT, r);
  });
  var chrome =
    process.env.CHROME_PATH ||
    (fs.existsSync('/usr/local/bin/google-chrome')
      ? '/usr/local/bin/google-chrome'
      : '/usr/bin/google-chrome');
  var browser = await puppeteer.launch({
    executablePath: chrome,
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  try {
    var page = await browser.newPage();
    await page.evaluateOnNewDocument(function () {
      try {
        localStorage.setItem('rs_age_ok', '1');
        // Suppress channel permanently so group timer can arm immediately.
        localStorage.setItem('rs_tg_hide_v2', '1');
        // Clear group permanent hide only once per tab session so JOIN NOW persistence can be tested across reloads.
        if (!sessionStorage.getItem('__tg_group_test_init')) {
          sessionStorage.setItem('__tg_group_test_init', '1');
          localStorage.removeItem('rs_tg_group_hide_v1');
        }
      } catch (e) {}
      window.__TG_GROUP_FIRST_MS = 800;
      window.__TG_GROUP_RETRY_MS = 1000;
    });
    await page.goto('http://127.0.0.1:' + PORT + '/', { waitUntil: 'domcontentloaded', timeout: 60000 });
    // Wait for boot + 1.2s channel decision + first active window
    await sleep(2800);
    var first = await page.evaluate(function () {
      var m = document.getElementById('modal-tg-group');
      var ch = document.getElementById('modal-tg');
      return {
        groupShow: !!(m && m.classList.contains('show')),
        channelShow: !!(ch && ch.classList.contains('show')),
        title: (document.getElementById('tg-group-title') || {}).textContent || '',
        joinHref: (document.getElementById('tg-group-join') || {}).getAttribute('href'),
        joinText: ((document.getElementById('tg-group-join') || {}).textContent || '').trim(),
        dismiss: Number(window.__tgGroupDismissCount || 0) || 0,
      };
    });
    assert(first.groupShow, 'group appears after ~1s active browsing (accelerated)');
    assert(!first.channelShow, 'channel not shown simultaneously');
    assert(/THE OFFICIAL/.test(first.title) && /RUINEXPOSE/.test(first.title) && /GROUP/.test(first.title), 'title text exact-ish');
    assert(first.joinHref === 'https://t.me/ruinexpose', 'JOIN NOW href');
    assert(first.joinText === 'JOIN NOW', 'JOIN NOW label exact');

    // Dismiss #1 → wait retry delay → appear again
    await page.click('#tg-group-close-x');
    await sleep(400);
    var afterDismiss1 = await page.evaluate(function () {
      var m = document.getElementById('modal-tg-group');
      return {
        show: !!(m && m.classList.contains('show')),
        dismiss: Number(window.__tgGroupDismissCount || 0) || 0,
      };
    });
    assert(!afterDismiss1.show, 'group hidden after first dismiss');
    assert(afterDismiss1.dismiss === 1, 'session dismiss count = 1');

    await sleep(1600);
    var second = await page.evaluate(function () {
      var m = document.getElementById('modal-tg-group');
      return {
        show: !!(m && m.classList.contains('show')),
        dismiss: Number(window.__tgGroupDismissCount || 0) || 0,
      };
    });
    assert(second.show, 'group reappears after 5-min active delay (accelerated)');

    // Dismiss #2 → must never show again this session
    await page.click('#tg-group-close-x');
    await sleep(400);
    await sleep(2000);
    var afterDismiss2 = await page.evaluate(function () {
      var m = document.getElementById('modal-tg-group');
      return {
        show: !!(m && m.classList.contains('show')),
        dismiss: Number(window.__tgGroupDismissCount || 0) || 0,
        permanent: localStorage.getItem('rs_tg_group_hide_v1'),
      };
    });
    assert(!afterDismiss2.show, 'group stays hidden after second dismiss');
    assert(afterDismiss2.dismiss >= 2, 'session dismiss count = 2');
    assert(afterDismiss2.permanent !== '1', 'soft dismiss does not permanent-hide');

    // Reload resets session counter; permanent still off → can show again
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(2800);
    var afterReload = await page.evaluate(function () {
      var m = document.getElementById('modal-tg-group');
      return {
        show: !!(m && m.classList.contains('show')),
        dismiss: Number(window.__tgGroupDismissCount || 0) || 0,
      };
    });
    assert(afterReload.show, 'after reload, group can appear again');
    assert(afterReload.dismiss === 0, 'reload resets session dismiss counter');

    // JOIN NOW permanently suppresses
    await page.evaluate(function () {
      // prevent actual navigation away in headless
      var a = document.getElementById('tg-group-join');
      if (a) a.addEventListener('click', function (e) { e.preventDefault(); }, true);
    });
    await page.click('#tg-group-join');
    await sleep(400);
    var afterJoin = await page.evaluate(function () {
      return {
        permanent: localStorage.getItem('rs_tg_group_hide_v1'),
        show: !!(document.getElementById('modal-tg-group') && document.getElementById('modal-tg-group').classList.contains('show')),
      };
    });
    assert(afterJoin.permanent === '1', 'JOIN NOW sets permanent hide');
    assert(!afterJoin.show, 'modal closed after JOIN NOW');

    await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(2800);
    var suppressed = await page.evaluate(function () {
      var m = document.getElementById('modal-tg-group');
      return {
        show: !!(m && m.classList.contains('show')),
        permanent: localStorage.getItem('rs_tg_group_hide_v1'),
      };
    });
    assert(suppressed.permanent === '1', 'permanent hide survives reload');
    assert(!suppressed.show, 'group never reappears after JOIN NOW');

    // Active browsing pause: hidden tab must not accumulate
    await page.evaluate(function () {
      try { localStorage.removeItem('rs_tg_group_hide_v1'); } catch (e) {}
      window.__tgGroupDismissCount = 0;
      window.__tgGroupWatchStarted = false;
      window.__tgGroupActiveMs = 0;
      window.__TG_GROUP_FIRST_MS = 5000;
      window.__TG_GROUP_RETRY_MS = 5000;
      if (window.__tgGroupTickTimer) { clearInterval(window.__tgGroupTickTimer); window.__tgGroupTickTimer = null; }
      startTgGroupActiveWatch(false);
    });
    // Simulate hidden tab via document.hidden override is hard; call visibility path by evaluating pause logic
    var pauseCheck = await page.evaluate(function () {
      Object.defineProperty(document, 'hidden', { configurable: true, get: function () { return true; } });
      window.__tgGroupLastTick = Date.now() - 2000;
      window.__tgGroupActiveMs = 0;
      tgGroupTick();
      var whileHidden = Number(window.__tgGroupActiveMs || 0) || 0;
      Object.defineProperty(document, 'hidden', { configurable: true, get: function () { return false; } });
      window.__tgGroupLastTick = Date.now() - 2000;
      tgGroupTick();
      var whileVisible = Number(window.__tgGroupActiveMs || 0) || 0;
      return { whileHidden: whileHidden, whileVisible: whileVisible };
    });
    assert(pauseCheck.whileHidden === 0, 'hidden tab does not accumulate active time');
    assert(pauseCheck.whileVisible > 0, 'visible tab accumulates active time');

    // Channel-close path: group must wait until channel invitation is dismissed.
    var page2 = await browser.newPage();
    await page2.evaluateOnNewDocument(function () {
      try {
        localStorage.setItem('rs_age_ok', '1');
        localStorage.removeItem('rs_tg_hide_v2');
        localStorage.removeItem('rs_tg_soft_v2');
        localStorage.removeItem('rs_tg_group_hide_v1');
      } catch (e) {}
      window.__TG_GROUP_FIRST_MS = 700;
      window.__TG_GROUP_RETRY_MS = 1000;
    });
    await page2.goto('http://127.0.0.1:' + PORT + '/', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(2000);
    var channelOpen = await page2.evaluate(function () {
      var ch = document.getElementById('modal-tg');
      var g = document.getElementById('modal-tg-group');
      return {
        channel: !!(ch && ch.classList.contains('show')),
        group: !!(g && g.classList.contains('show')),
        watch: !!window.__tgGroupWatchStarted,
      };
    });
    assert(channelOpen.channel, 'channel invitation still shows when not suppressed');
    assert(!channelOpen.group, 'group does not show while channel is open');
    assert(!channelOpen.watch, 'group timer not started while channel open');
    await page2.click('#tg-dismiss');
    await sleep(500);
    var afterChannelClose = await page2.evaluate(function () {
      return {
        channel: !!(document.getElementById('modal-tg') && document.getElementById('modal-tg').classList.contains('show')),
        group: !!(document.getElementById('modal-tg-group') && document.getElementById('modal-tg-group').classList.contains('show')),
        watch: !!window.__tgGroupWatchStarted,
      };
    });
    assert(!afterChannelClose.channel, 'channel closed via Maybe later');
    assert(afterChannelClose.watch, 'group timer starts after channel close');
    assert(!afterChannelClose.group, 'group not instant after channel close');
    await sleep(1200);
    var groupAfterWait = await page2.evaluate(function () {
      return !!(document.getElementById('modal-tg-group') && document.getElementById('modal-tg-group').classList.contains('show'));
    });
    assert(groupAfterWait, 'group shows after active browsing following channel close');
    try { await page2.close(); } catch (e) {}

    console.log('\nBrowser group-popup sequence checks passed');
  } finally {
    try { await browser.close(); } catch (e) {}
    try { server.close(); } catch (e) {}
  }
})().catch(function (err) {
  console.error('FAIL · browser sequence:', err && err.stack ? err.stack : err);
  process.exit(1);
});
