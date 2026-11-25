#!/usr/bin/env node
/**
 * Browser e2e: sticky intercepting SW → blank page; updating /sw.js to the
 * kill-switch recovers the next navigation without needing new HTML first.
 */
'use strict';
var http = require('http');
var fs = require('fs');
var path = require('path');
var puppeteer = require('puppeteer-core');

var PORT = 4179;
var root = path.join(__dirname, '..');

var BAD_SW =
  "self.addEventListener('install',e=>self.skipWaiting());" +
  "self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));" +
  "self.addEventListener('fetch',e=>{" +
  "  if(e.request.mode==='navigate'){" +
  "    e.respondWith(new Response('<!doctype html><html><body style=\"background:#000\"></body></html>',{headers:{'Content-Type':'text/html'}}));" +
  "  }" +
  "});";

var KILL_SW = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
var REAL_PAGE =
  '<!doctype html><html><head><meta charset="utf-8"/><title>SW kill probe</title></head>' +
  '<body style="background:#111;color:#fff"><h1 id="ok">SITE OK</h1></body></html>';

var mode = 'bad';

function assert(cond, msg) {
  if (!cond) throw new Error('FAIL · ' + msg);
  console.log('PASS · ' + msg);
}
function sleep(ms) {
  return new Promise(function (r) {
    setTimeout(r, ms);
  });
}

var server = http.createServer(function (req, res) {
  var u = req.url.split('?')[0];
  if (u === '/sw.js') {
    res.writeHead(200, {
      'Content-Type': 'application/javascript',
      'Cache-Control': 'no-store',
      'Service-Worker-Allowed': '/'
    });
    res.end(mode === 'bad' ? BAD_SW : KILL_SW);
    return;
  }
  if (u === '/' || u === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' });
    if (mode === 'bad') {
      res.end(
        '<!doctype html><html><body><h1 id="seed">SEED</h1>' +
          '<script>navigator.serviceWorker.register("/sw.js").then(function(){setTimeout(function(){location.reload()},400)})</script>' +
          '</body></html>'
      );
    } else {
      res.end(REAL_PAGE);
    }
    return;
  }
  res.writeHead(404);
  res.end('no');
});

async function main() {
  await new Promise(function (r) {
    server.listen(PORT, '127.0.0.1', r);
  });
  var browser = await puppeteer.launch({
    executablePath: '/usr/bin/google-chrome-stable',
    headless: true,
    protocolTimeout: 60000,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  });
  try {
    var page = await browser.newPage();
    page.setDefaultTimeout(30000);
    var base = 'http://127.0.0.1:' + PORT + '/';

    mode = 'bad';
    await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForFunction(
      function () {
        return !!navigator.serviceWorker.controller;
      },
      { timeout: 15000 }
    );
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 20000 });
    var blank = await page.evaluate(function () {
      return {
        text: ((document.body && document.body.innerText) || '').trim(),
        hasOk: !!document.getElementById('ok'),
        hasSeed: !!document.getElementById('seed'),
        controlled: !!(navigator.serviceWorker && navigator.serviceWorker.controller)
      };
    });
    assert(blank.controlled, 'bad SW controls the page');
    assert(!blank.hasOk && !blank.hasSeed && blank.text === '', 'bad SW serves blank page (Incognito-only symptom)');

    // Publish kill-switch at the same script URL and force update while blank.
    mode = 'kill';
    await page.evaluate(function () {
      return navigator.serviceWorker.getRegistration().then(function (reg) {
        return reg ? reg.update() : null;
      });
    });

    // Wait for kill-switch activate → unregister (regs length 0) or claim without fetch.
    for (var i = 0; i < 40; i++) {
      await sleep(150);
      var snap = await page.evaluate(function () {
        return navigator.serviceWorker.getRegistrations().then(function (regs) {
          return (regs || []).length;
        });
      });
      if (snap === 0) break;
    }

    // Fresh navigation from the browser chrome — must hit network HTML now.
    await page.goto(base + '?recovered=1', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await sleep(300);
    var state = await page.evaluate(function () {
      return navigator.serviceWorker.getRegistrations().then(function (regs) {
        return {
          regs: (regs || []).length,
          controlled: !!(navigator.serviceWorker && navigator.serviceWorker.controller),
          hasOk: !!document.getElementById('ok'),
          text: ((document.body && document.body.innerText) || '').trim()
        };
      });
    });
    assert(state.hasOk && /SITE OK/.test(state.text), 'after kill-switch update, real page content renders');
    assert(!state.controlled, 'page is not controlled by an intercepting SW');
    console.log('OK · sw-kill-browser-e2e');
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch(function (e) {
  console.error(e && e.stack ? e.stack : e);
  try {
    server.close();
  } catch (err) {}
  process.exit(1);
});
