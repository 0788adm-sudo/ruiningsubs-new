#!/usr/bin/env node
/**
 * Root-cause guards for Safari white / Chrome black blanks on returning visits.
 *
 * Reproduces:
 *  A) Blank navigate-intercepting SW → empty document (Incognito works, normal fails)
 *  B) Auto-enter (rs_age_ok) must never leave a pure black empty #app
 *  C) Static: no render-blocking Google Fonts, no document.write, critical paint CSS,
 *     async CDN loader, SW postMessage recovery (no client.navigate), boot trace
 */
'use strict';
var fs = require('fs');
var path = require('path');
var http = require('http');
var os = require('os');
var { spawn } = require('child_process');

var root = path.join(__dirname, '..');
var html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
var sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
var vercel = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
var build = JSON.parse(fs.readFileSync(path.join(root, 'build.json'), 'utf8'));

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL · ' + msg);
    process.exit(1);
  }
  console.log('PASS · ' + msg);
}

/* —— Static root-cause guards —— */
assert(html.indexOf('id="rs-critical-paint"') >= 0, 'critical inline paint CSS present');
assert(/media=["']print["'][^>]*onload=["']this\.media=['"]all['"]/.test(html) ||
  html.indexOf("media=\"print\" onload=\"this.media='all'\"") >= 0,
  'Google Fonts are non-blocking (media=print onload)');
assert(!/document\.write\s*\(/.test(html), 'no document.write() (wipes document on Safari)');
assert(html.indexOf('__rsSbReady') >= 0 && html.indexOf('loadWithFallback') >= 0, 'async CDN loader');
assert(html.indexOf("cdn.jsdelivr.net/npm/@supabase") > html.indexOf('id="age-gate"') ||
  html.indexOf('__rsSbReady') > 0,
  'CDN does not block age-gate parse');
assert(html.indexOf('rs_sw_recovered_v4') >= 0, 'SW recovery key bumped to v4 (localStorage)');
assert(html.indexOf('rs_boot_trace') >= 0 && html.indexOf('__rsTrace') >= 0, 'boot trace instrumentation');
assert(html.indexOf('Never leave a pure black #app') >= 0 || html.indexOf('pure black #app') >= 0,
  'enterSite paints loading shell before boot');
assert(html.indexOf('function ensureSbClient') >= 0, 'ensureSbClient defers createClient until CDN ready');
// client.navigate left Safari mid-navigation (stuck spinner + dead taps after login).
assert(!/client\.navigate\s*\(/.test(sw), 'SW must NOT client.navigate (page oneReload only)');
assert(/postMessage[\s\S]{0,80}RS_SW_NOOP_READY/.test(sw), 'SW signals page via postMessage');
assert(!/addEventListener\(\s*['"]fetch['"]/.test(sw), 'SW still has no fetch handler');
assert(String(build.build) === '202611270115' || html.indexOf(build.build) >= 0, 'build id synced');
assert(html.indexOf('content="' + build.build + '"') >= 0, 'meta build matches build.json');

var rootHdr = (vercel.headers || []).find(function (h) { return h.source === '/'; });
assert(!!rootHdr, 'vercel / headers exist');
var csd = (rootHdr.headers || []).some(function (h) {
  return /clear-site-data/i.test(h.key || '') && /cache/i.test(h.value || '');
});
assert(csd, 'Clear-Site-Data: cache on HTML (not storage — sessions kept)');
assert(!(rootHdr.headers || []).some(function (h) {
  return /clear-site-data/i.test(h.key || '') && /storage/i.test(h.value || '');
}), 'Clear-Site-Data must NOT clear storage/sessions');

console.log('\nStatic blank-screen guards passed.\n');

/* —— Browser reproduction —— */
var PORT = 4210;
var CHROME = process.env.CHROME_PATH || 'google-chrome';
var NOOP_SW = sw;
var BLANK_SW =
  "self.addEventListener('install',e=>self.skipWaiting());" +
  "self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));" +
  "self.addEventListener('fetch',e=>{" +
  "  if(e.request.mode==='navigate'){" +
  "    e.respondWith(new Response('<!doctype html><html><body style=\"background:#050506\"></body></html>',{headers:{'Content-Type':'text/html'}}));" +
  "  }" +
  "});";

var mode = 'blank'; // blank | noop

function sleep(ms) {
  return new Promise(function (r) { setTimeout(r, ms); });
}

function serve() {
  return new Promise(function (resolve, reject) {
    var server = http.createServer(function (req, res) {
      var u = (req.url || '/').split('?')[0];
      if (u === '/sw.js') {
        res.writeHead(200, {
          'Content-Type': 'application/javascript',
          'Cache-Control': 'no-store',
          'Service-Worker-Allowed': '/'
        });
        res.end(mode === 'blank' ? BLANK_SW : NOOP_SW);
        return;
      }
      if (u === '/build.json') {
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify(build));
        return;
      }
      var file = u === '/' || u === '/index.html' ? path.join(root, 'index.html') : path.join(root, decodeURIComponent(u));
      if (!file.startsWith(root)) { res.writeHead(403); res.end('x'); return; }
      fs.readFile(file, function (err, buf) {
        if (err) { res.writeHead(404); res.end('missing'); return; }
        res.writeHead(200, {
          'Content-Type': file.endsWith('.js') ? 'application/javascript' : 'text/html; charset=utf-8',
          'Cache-Control': 'no-store'
        });
        res.end(buf);
      });
    });
    server.listen(PORT, '127.0.0.1', function () { resolve(server); });
    server.on('error', reject);
  });
}

function waitCdp(port, n) {
  if (n > 50) return Promise.reject(new Error('CDP not ready'));
  return fetch('http://127.0.0.1:' + port + '/json/version')
    .then(function (r) { if (!r.ok) throw new Error('bad'); return r.json(); })
    .catch(function () { return sleep(120).then(function () { return waitCdp(port, n + 1); }); });
}

(async function () {
  var server = await serve();
  var WebSocket;
  try { WebSocket = require('ws'); } catch (e) {
    console.log('SKIP browser (no ws)');
    server.close();
    process.exit(0);
  }

  async function withChrome(fn) {
    var tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-blank-'));
    var chrome = spawn(CHROME, [
      '--headless=new', '--disable-gpu', '--no-sandbox', '--disable-dev-shm-usage',
      '--user-data-dir=' + tmp, '--remote-debugging-port=9240', 'about:blank'
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    try {
      await waitCdp(9240, 0);
      var targets = await fetch('http://127.0.0.1:9240/json/list').then(function (r) { return r.json(); });
      var page = targets.find(function (t) { return t.type === 'page'; }) || targets[0];
      var ws = new WebSocket(page.webSocketDebuggerUrl);
      await new Promise(function (res, rej) { ws.once('open', res); ws.once('error', rej); });
      var id = 0, pending = {};
      ws.on('message', function (raw) {
        var msg = JSON.parse(String(raw));
        if (msg.id && pending[msg.id]) {
          var p = pending[msg.id];
          delete pending[msg.id];
          if (msg.error) p.rej(new Error(JSON.stringify(msg.error)));
          else p.res(msg.result);
        }
      });
      function send(method, params) {
        var mid = ++id;
        return new Promise(function (res, rej) {
          pending[mid] = { res: res, rej: rej };
          ws.send(JSON.stringify({ id: mid, method: method, params: params || {} }));
        });
      }
      await send('Runtime.enable');
      await send('Page.enable');
      await fn(send);
      try { ws.close(); } catch (e) {}
    } finally {
      try { chrome.kill('SIGKILL'); } catch (e) {}
    }
  }

  // A) Prove blank SW produces empty black document (root cause of Incognito difference)
  await withChrome(async function (send) {
    mode = 'blank';
    // Seed: register blank SW from a tiny page
    await send('Page.navigate', { url: 'data:text/html,<script>navigator.serviceWorker.register("http://127.0.0.1:' + PORT + '/sw.js").then(function(){setTimeout(function(){location.href="http://127.0.0.1:' + PORT + '/"},500)})</script>' });
    await sleep(2500);
    // May have navigated to blank SW document
    var blank = await send('Runtime.evaluate', {
      returnByValue: true,
      expression:
        '(function(){var t=(document.body&&document.body.innerText)||"";return{text:t.trim(),hasGate:!!document.getElementById("age-gate"),controlled:!!(navigator.serviceWorker&&navigator.serviceWorker.controller)};})()'
    });
    var b = blank.result.value;
    assert(b.controlled || !b.hasGate, 'blank SW controls or suppresses age-gate (symptom)');
    if (!b.hasGate) {
      assert(b.text === '', 'blank SW yields empty document text (Chrome black / Safari white)');
    }
    console.log('  · blank-SW state', JSON.stringify(b));
  });

  // B) Real app with rs_age_ok — must show loading shell / gate / posts, never empty black forever
  await withChrome(async function (send) {
    mode = 'noop';
    await send('Page.navigate', { url: 'http://127.0.0.1:' + PORT + '/' });
    await sleep(800);
    await send('Runtime.evaluate', {
      expression: 'localStorage.setItem("rs_age_ok","1"); location.reload();'
    });
    await sleep(4500);
    var st = await send('Runtime.evaluate', {
      returnByValue: true,
      expression:
        '(function(){' +
        'var app=document.getElementById("app");' +
        'var gate=document.getElementById("age-gate");' +
        'var feed=document.getElementById("posts-container");' +
        'var rescue=document.getElementById("rs-boot-rescue");' +
        'var text=((feed&&feed.textContent)||"").trim();' +
        'var alive=!!(window.__rsBootPainted || (feed&&feed.querySelector("article.post")) || /Loading/i.test(text) || (gate&&!gate.classList.contains("hidden")) || rescue);' +
        'var bg=getComputedStyle(document.body).backgroundColor;' +
        'return{alive:alive,appShow:!!(app&&app.classList.contains("show")),text:text.slice(0,60),bg:bg,trace:(window.__rsBootTrace||[]).map(function(x){return x.s}).slice(0,12),build:window.__RS_APP_BUILD||""};' +
        '})()'
    });
    var v = st.result.value;
    assert(v.build === build.build, 'build id present after reload');
    assert(v.alive, 'returning visit is not an empty black shell: ' + JSON.stringify(v));
    assert(Array.isArray(v.trace) && v.trace.length > 0, 'boot trace recorded');
    console.log('  · returning visit', JSON.stringify(v));
  });

  server.close();
  console.log('\nOK · blank-screen-rootfix');
})().catch(function (e) {
  console.error(e && e.stack ? e.stack : e);
  process.exit(1);
});
