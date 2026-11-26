#!/usr/bin/env node
/**
 * Headless Chrome matrix for load / freeze recovery:
 * A) First visit (clean profile) — age gate or app paints
 * B) Return visit with rs_age_ok — feed leaves Loading
 * C) Ghost overlay must not block nav after releaseInteractionBlockers
 * D) build.json freshness probe reachable
 * E) Incognito-like (temp profile) same as A
 */
'use strict';
var http = require('http');
var fs = require('fs');
var path = require('path');
var os = require('os');
var { spawn } = require('child_process');

var root = path.join(__dirname, '..');
var PORT = 4197;
var CHROME = process.env.CHROME_PATH || 'google-chrome';

function assert(cond, msg) {
  if (!cond) throw new Error('FAIL · ' + msg);
  console.log('PASS · ' + msg);
}
function sleep(ms) {
  return new Promise(function (r) {
    setTimeout(r, ms);
  });
}
function contentType(fp) {
  if (fp.endsWith('.js')) return 'application/javascript; charset=utf-8';
  if (fp.endsWith('.json')) return 'application/json; charset=utf-8';
  if (fp.endsWith('.webmanifest')) return 'application/manifest+json';
  return 'text/html; charset=utf-8';
}
function cacheFor(urlPath) {
  if (urlPath === '/sw.js' || urlPath === '/build.json' || urlPath === '/' || urlPath === '/index.html' || !path.extname(urlPath)) {
    return 'no-cache, no-store, must-revalidate, max-age=0';
  }
  return 'public, max-age=60';
}

function serve() {
  return new Promise(function (resolve, reject) {
    var server = http.createServer(function (req, res) {
      var urlPath = (req.url || '/').split('?')[0].split('#')[0];
      if (urlPath === '/') urlPath = '/index.html';
      // SPA routes
      var spa = [
        '/wall',
        '/feed',
        '/profile',
        '/explore',
        '/goontok',
        '/login'
      ];
      if (spa.indexOf(urlPath) >= 0 || spa.indexOf(urlPath.replace(/\/$/, '')) >= 0) {
        urlPath = '/index.html';
      }
      var file = path.join(root, decodeURIComponent(urlPath));
      if (!file.startsWith(root)) {
        res.writeHead(403);
        res.end('forbidden');
        return;
      }
      fs.readFile(file, function (err, buf) {
        if (err) {
          res.writeHead(404, { 'Cache-Control': 'no-store' });
          res.end('missing');
          return;
        }
        res.writeHead(200, {
          'Content-Type': contentType(file),
          'Cache-Control': cacheFor(urlPath),
          'CDN-Cache-Control': 'no-store'
        });
        res.end(buf);
      });
    });
    server.listen(PORT, '127.0.0.1', function () {
      resolve(server);
    });
    server.on('error', reject);
  });
}

function waitCdp(n) {
  if (n > 50) return Promise.reject(new Error('CDP not ready'));
  return fetch('http://127.0.0.1:9229/json/version')
    .then(function (r) {
      if (!r.ok) throw new Error('bad');
      return r.json();
    })
    .catch(function () {
      return sleep(150).then(function () {
        return waitCdp(n + 1);
      });
    });
}

async function withChrome(userData, fn) {
  var chrome = spawn(
    CHROME,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--user-data-dir=' + userData,
      '--remote-debugging-port=9229',
      'about:blank'
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] }
  );
  try {
    await waitCdp(0);
    var targets = await fetch('http://127.0.0.1:9229/json/list').then(function (r) {
      return r.json();
    });
    var page = targets.find(function (t) {
      return t.type === 'page';
    }) || targets[0];
    var WebSocket = require('ws');
    var ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise(function (res, rej) {
      ws.once('open', res);
      ws.once('error', rej);
    });
    var id = 0;
    var pending = {};
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
    try {
      ws.close();
    } catch (e) {}
  } finally {
    try {
      chrome.kill('SIGKILL');
    } catch (e) {}
  }
}

(async function () {
  var server = await serve();
  try {
    // D) build.json
    var bj = await fetch('http://127.0.0.1:' + PORT + '/build.json').then(function (r) {
      return r.json();
    });
    assert(bj && bj.build, 'build.json served locally');

    var tmpA = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-load-a-'));
    await withChrome(tmpA, async function (send) {
      await send('Page.navigate', { url: 'http://127.0.0.1:' + PORT + '/' });
      await sleep(2500);
      var r = await send('Runtime.evaluate', {
        expression:
          '(function(){var g=document.getElementById("age-gate");var a=document.getElementById("app");' +
          'var gateVisible=g&&!g.classList.contains("hidden");' +
          'var appShow=a&&a.classList.contains("show");' +
          'return {gateVisible:!!gateVisible,appShow:!!appShow,build:window.__RS_APP_BUILD||"",hasEnter:typeof enterSite==="function"};})()',
        returnByValue: true
      });
      var v = r.result.value;
      assert(v.hasEnter, 'enterSite available');
      assert(v.build, 'build id present in page');
      assert(v.gateVisible || v.appShow, 'first visit shows age gate or app');
    });

    var tmpB = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-load-b-'));
    await withChrome(tmpB, async function (send) {
      await send('Page.navigate', { url: 'http://127.0.0.1:' + PORT + '/' });
      await sleep(800);
      await send('Runtime.evaluate', {
        expression: 'localStorage.setItem("rs_age_ok","1"); location.reload();',
        returnByValue: true
      });
      await sleep(4500);
      var r = await send('Runtime.evaluate', {
        expression:
          '(function(){var a=document.getElementById("app");var feed=document.getElementById("posts-container");' +
          'var text=(feed&&feed.textContent)||"";' +
          'var stuck=/^\\s*Loading/i.test(text.trim()) && !(feed&&feed.querySelector("article.post"));' +
          'return {appShow:!!(a&&a.classList.contains("show")),stuck:stuck,text:text.slice(0,80),' +
          'hasWatchdog:!!window.__rsWatchdogArmed,hasErr:!!window.__rsErrArmed};})()',
        returnByValue: true
      });
      var v = r.result.value;
      assert(v.appShow, 'return visit auto-enters app');
      assert(!v.stuck, 'feed not stuck on Loading forever: ' + v.text);
      assert(v.hasWatchdog, 'interaction watchdog armed');
      assert(v.hasErr, 'global error recovery armed');

      // C) inject ghost overlay then ensure release clears pointer-events
      await send('Runtime.evaluate', {
        expression:
          '(function(){var el=document.getElementById("modal-tg-group");' +
          'if(!el){el=document.createElement("div");el.id="modal-tg-group";document.body.appendChild(el);}' +
          'el.className="show";el.style.opacity="0";el.style.pointerEvents="auto";el.style.display="flex";' +
          'el.style.position="fixed";el.style.inset="0";el.style.zIndex="99999";' +
          'if(typeof releaseInteractionBlockers==="function") releaseInteractionBlockers({});' +
          'var st=getComputedStyle(el);' +
          'return {pe:st.pointerEvents,hasShow:el.classList.contains("show")};})()',
        returnByValue: true
      }).then(function (out) {
        var g = out.result.value;
        assert(g.pe === 'none' || !g.hasShow, 'ghost overlay released after blocker sweep');
      });

      // Navigate SPA route /wall
      await send('Page.navigate', { url: 'http://127.0.0.1:' + PORT + '/wall' });
      await sleep(3000);
      var wall = await send('Runtime.evaluate', {
        expression:
          '(function(){var p=document.getElementById("panel-wall")||document.querySelector(".panel.active");' +
          'return {ok:!!(p&&(p.offsetHeight>20||p.classList.contains("active"))),build:window.__RS_APP_BUILD||""};})()',
        returnByValue: true
      });
      assert(wall.result.value.ok || wall.result.value.build, 'SPA /wall loads document with app');
    });

    console.log('\nOK · load-cache-browser-e2e');
  } finally {
    server.close();
  }
})().catch(function (e) {
  console.error(e && e.stack ? e.stack : e);
  process.exit(1);
});
