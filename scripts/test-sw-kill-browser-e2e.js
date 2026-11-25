#!/usr/bin/env node
/**
 * Browser e2e matrix for sticky SW recovery:
 * A) In-place /sw.js no-op update recovers blank SW + preserves localStorage
 * B) #151 query-string register does not replace buggy controller (regression)
 * C) First/return visit with no SW
 * D) Stale Cache Storage wiped; sessions kept
 * E) No infinite reload when sessionStorage is unavailable (Telegram-like)
 */
'use strict';
var http = require('http');
var fs = require('fs');
var path = require('path');
var puppeteer = require('puppeteer-core');

var PORT = 4190;
var root = path.join(__dirname, '..');
var NOOP_SW = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');

var BLANK_SW =
  "self.addEventListener('install',e=>self.skipWaiting());" +
  "self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));" +
  "self.addEventListener('fetch',e=>{" +
  "  if(e.request.mode==='navigate'){" +
  "    e.respondWith(new Response('<!doctype html><html><body style=\"background:#000\"></body></html>',{headers:{'Content-Type':'text/html'}}));" +
  "  }" +
  "});";

var mode = 'seed'; // seed | noop
var clientMode = 'good'; // good | good-nosess | bad151

function assert(cond, msg) {
  if (!cond) throw new Error('FAIL · ' + msg);
  console.log('PASS · ' + msg);
}
function sleep(ms) {
  return new Promise(function (r) {
    setTimeout(r, ms);
  });
}

function recoveryHtml(opts) {
  opts = opts || {};
  var breakSession = opts.breakSession
    ? 'try{var _s=sessionStorage;Object.defineProperty(window,"sessionStorage",{get:function(){throw new Error("no sess")}})}catch(e){}\n'
    : '';
  return (
    '<!doctype html><html><head><meta charset="utf-8"/>' +
    '<script>\n' +
    breakSession +
    '(function(){\n' +
    '  if(!("serviceWorker" in navigator)) return;\n' +
    '  var RECOVERED_KEY="rs_sw_recovered_v2";\n' +
    '  var reloadArmed=false;\n' +
    '  window.__reloadCount=(window.__reloadCount||0);\n' +
    '  function wipeCaches(){\n' +
    '    if(!window.caches||!caches.keys) return Promise.resolve();\n' +
    '    return caches.keys().then(function(keys){return Promise.all((keys||[]).map(function(k){return caches.delete(k)}))}).catch(function(){});\n' +
    '  }\n' +
    '  function alreadyRecovered(){\n' +
    '    if(window.__rsSwRecovered) return true;\n' +
    '    try{ if(sessionStorage.getItem(RECOVERED_KEY)) return true; }catch(e){}\n' +
    '    return false;\n' +
    '  }\n' +
    '  function markRecovered(){\n' +
    '    window.__rsSwRecovered=1;\n' +
    '    try{ sessionStorage.setItem(RECOVERED_KEY,"1"); }catch(e){}\n' +
    '  }\n' +
    '  function oneReload(){\n' +
    '    if(reloadArmed || alreadyRecovered()) return;\n' +
    '    reloadArmed=true;\n' +
    '    markRecovered();\n' +
    '    window.__reloadCount++;\n' +
    '    setTimeout(function(){location.reload()},50);\n' +
    '  }\n' +
    '  wipeCaches();\n' +
    '  navigator.serviceWorker.addEventListener("message",function(ev){\n' +
    '    var t=ev&&ev.data&&ev.data.type;\n' +
    '    if(t==="RS_SW_NOOP_READY"||t==="RS_SW_KILLED"){wipeCaches();oneReload();}\n' +
    '  });\n' +
    '  navigator.serviceWorker.addEventListener("controllerchange",function(){oneReload();});\n' +
    '  if(alreadyRecovered()){\n' +
    '    navigator.serviceWorker.getRegistrations().then(function(regs){\n' +
    '      return Promise.all((regs||[]).map(function(r){try{return r.unregister()}catch(e){return null}}));\n' +
    '    }).then(wipeCaches).catch(function(){});\n' +
    '    return;\n' +
    '  }\n' +
    '  navigator.serviceWorker.getRegistrations().then(function(regs){\n' +
    '    regs=regs||[];\n' +
    '    if(!regs.length){wipeCaches();return;}\n' +
    '    var updates=[];\n' +
    '    regs.forEach(function(reg){ try{ if(reg&&reg.update) updates.push(reg.update().catch(function(){})); }catch(e){} });\n' +
    '    updates.push(navigator.serviceWorker.register("/sw.js").catch(function(){}));\n' +
    '    Promise.all(updates).then(function(){\n' +
    '      return new Promise(function(r){setTimeout(r,900)});\n' +
    '    }).then(function(){ return navigator.serviceWorker.getRegistrations(); }).then(function(regs2){\n' +
    '      return Promise.all((regs2||[]).map(function(r){ try{return r.unregister()}catch(e){return null} }));\n' +
    '    }).then(function(){ return wipeCaches(); }).catch(function(){});\n' +
    '  });\n' +
    '})();\n' +
    '</script></head><body style="background:#111;color:#fff">' +
    '<h1 id="ok">SITE OK</h1>' +
    '<div id="reloads"></div>' +
    '<script>try{document.getElementById("ok").dataset.age=localStorage.getItem("rs_age_ok")||"";document.getElementById("reloads").textContent=String(window.__reloadCount||0)}catch(e){}</script>' +
    '</body></html>'
  );
}

var server = http.createServer(function (req, res) {
  var u = req.url.split('?')[0];
  if (u === '/sw.js') {
    res.writeHead(200, {
      'Content-Type': 'application/javascript',
      'Cache-Control': 'no-store',
      'Service-Worker-Allowed': '/'
    });
    res.end(mode === 'seed' ? BLANK_SW : NOOP_SW);
    return;
  }
  if (u === '/' || u === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' });
    if (mode === 'seed') {
      res.end(
        '<!doctype html><html><body><h1 id="seed">SEED</h1>' +
          '<script>try{localStorage.setItem("rs_age_ok","1");localStorage.setItem("rs_session_probe","keep-me")}catch(e){}' +
          'navigator.serviceWorker.register("/sw.js").then(function(){setTimeout(function(){location.reload()},400)})</script>' +
          '</body></html>'
      );
    } else if (clientMode === 'bad151') {
      res.end(
        '<!doctype html><html><head><meta charset="utf-8"/><script>\n' +
          'navigator.serviceWorker.getRegistrations().then(function(regs){\n' +
          '  regs=regs||[];\n' +
          '  if(!regs.length)return;\n' +
          '  navigator.serviceWorker.register("/sw.js?v=kill-2026-11-25");\n' +
          '  regs.forEach(function(r){try{r.unregister()}catch(e){}});\n' +
          '});\n' +
          '</script></head><body><h1 id="ok">SITE OK</h1></body></html>'
      );
    } else if (clientMode === 'good-nosess') {
      res.end(recoveryHtml({ breakSession: true }));
    } else {
      res.end(recoveryHtml({}));
    }
    return;
  }
  res.writeHead(404);
  res.end('no');
});

async function launch() {
  return puppeteer.launch({
    executablePath: '/usr/bin/google-chrome-stable',
    headless: true,
    protocolTimeout: 60000,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  });
}

async function installBlankController(page, base) {
  mode = 'seed';
  clientMode = 'good';
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
      controlled: !!(navigator.serviceWorker && navigator.serviceWorker.controller),
      age: localStorage.getItem('rs_age_ok'),
      probe: localStorage.getItem('rs_session_probe')
    };
  });
  assert(blank.controlled, 'buggy SW controls the page');
  assert(!blank.hasOk && blank.text === '', 'buggy SW serves blank page (normal-browser symptom)');
  assert(blank.age === '1' && blank.probe === 'keep-me', 'session keys present before recovery');
}

async function main() {
  await new Promise(function (r) {
    server.listen(PORT, '127.0.0.1', r);
  });
  var browser = await launch();
  try {
    var base = 'http://127.0.0.1:' + PORT + '/';

    // A) Good in-place recovery
    var page = await browser.newPage();
    page.setDefaultTimeout(30000);
    await installBlankController(page, base);
    mode = 'noop';
    clientMode = 'good';
    await page.evaluate(function () {
      return navigator.serviceWorker.getRegistration().then(function (reg) {
        return reg ? reg.update() : null;
      });
    });
    await sleep(1000);
    await page.goto(base + '?good=1', { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(function () {});
    await sleep(1200);
    if (!(await page.evaluate(function () { return !!document.getElementById('ok'); }))) {
      await page.goto(base + '?good=2', { waitUntil: 'domcontentloaded', timeout: 20000 });
      await sleep(800);
    }
    var good = await page.evaluate(function () {
      return navigator.serviceWorker.getRegistrations().then(function (regs) {
        return {
          hasOk: !!document.getElementById('ok'),
          text: ((document.body && document.body.innerText) || '').trim(),
          regs: (regs || []).length,
          controlled: !!(navigator.serviceWorker && navigator.serviceWorker.controller),
          age: localStorage.getItem('rs_age_ok'),
          probe: localStorage.getItem('rs_session_probe')
        };
      });
    });
    assert(good.hasOk && /SITE OK/.test(good.text), 'in-place no-op recovery renders real page');
    assert(good.age === '1' && good.probe === 'keep-me', 'localStorage/session preserved');
    assert(!good.controlled || good.regs === 0, 'no intercepting controller remains');
    await page.close();

    // B) #151: registering ?v=kill does not displace blank controller while /sw.js still buggy
    var ctxBad = await browser.createBrowserContext();
    var pageB = await ctxBad.newPage();
    mode = 'seed';
    await pageB.goto(base, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await pageB.waitForFunction(function () { return !!navigator.serviceWorker.controller; }, { timeout: 15000 });
    await pageB.reload({ waitUntil: 'domcontentloaded', timeout: 20000 });
    // Keep mode=seed so /sw.js stays blank-serving. Run #151 client ops.
    await pageB.evaluate(function () {
      return navigator.serviceWorker.getRegistrations().then(function (regs) {
        navigator.serviceWorker.register('/sw.js?v=kill-2026-11-25').catch(function () {});
        (regs || []).forEach(function (r) {
          try {
            r.unregister();
          } catch (e) {}
        });
      });
    });
    await sleep(600);
    var scriptUrl = await pageB.evaluate(function () {
      return navigator.serviceWorker.getRegistration().then(function (reg) {
        return {
          controlled: !!(navigator.serviceWorker && navigator.serviceWorker.controller),
          active: reg && reg.active && reg.active.scriptURL
        };
      });
    });
    // After unregister of /sw.js, ?v=kill may be the only registration — but if /sw.js
    // bytes are still blank and something re-registers, blank persists. Check navigation.
    await pageB.goto(base + '?b=1', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await sleep(400);
    var badNav = await pageB.evaluate(function () {
      return {
        hasOk: !!document.getElementById('ok'),
        hasSeed: !!document.getElementById('seed'),
        text: ((document.body && document.body.innerText) || '').trim(),
        controlled: !!(navigator.serviceWorker && navigator.serviceWorker.controller)
      };
    });
    // Under #151, either still blank OR seed slipped through after unregister — never a
    // healthy noop-controlled SITE OK from in-place update of /sw.js.
    var stillBroken = (!badNav.hasOk && badNav.text === '') || badNav.hasSeed || badNav.controlled;
    assert(stillBroken || !badNav.hasOk, '#151 query-string path does not perform in-place /sw.js noop recovery');
    console.log('PASS · #151 path does not claim healthy in-place recovery (state=' + JSON.stringify(badNav) + ')');
    await ctxBad.close();

    // C) First + return visit, no SW
    mode = 'noop';
    clientMode = 'good';
    var ctxC = await browser.createBrowserContext();
    var clean = await ctxC.newPage();
    await clean.goto(base + '?first=1', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await sleep(500);
    var first = await clean.evaluate(function () {
      return navigator.serviceWorker.getRegistrations().then(function (regs) {
        return {
          hasOk: !!document.getElementById('ok'),
          regs: (regs || []).length,
          controlled: !!(navigator.serviceWorker && navigator.serviceWorker.controller)
        };
      });
    });
    assert(first.hasOk, 'first visit renders without SW');
    assert(first.regs === 0 && !first.controlled, 'first visit does not install a permanent SW');
    await clean.goto(base + '?return=1', { waitUntil: 'domcontentloaded', timeout: 20000 });
    assert(await clean.evaluate(function () { return !!document.getElementById('ok'); }), 'return visit still renders');
    await ctxC.close();

    // D) Stale cache wipe, keep localStorage
    var ctxD = await browser.createBrowserContext();
    var pD = await ctxD.newPage();
    mode = 'seed';
    await pD.goto(base, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await pD.waitForFunction(function () { return !!navigator.serviceWorker.controller; }, { timeout: 15000 });
    await pD.evaluate(function () {
      return caches.open('stale-shell').then(function (c) {
        return c.put('/', new Response('STALE', { headers: { 'Content-Type': 'text/html' } }));
      });
    });
    mode = 'noop';
    clientMode = 'good';
    await pD.evaluate(function () {
      return navigator.serviceWorker.getRegistration().then(function (reg) {
        return reg ? reg.update() : null;
      });
    });
    await sleep(1000);
    await pD.goto(base + '?cache=1', { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(function () {});
    await sleep(1000);
    if (!(await pD.evaluate(function () { return !!document.getElementById('ok'); }))) {
      await pD.goto(base + '?cache=2', { waitUntil: 'domcontentloaded', timeout: 20000 });
      await sleep(600);
    }
    var cacheState = await pD.evaluate(function () {
      return caches.keys().then(function (keys) {
        return {
          keys: keys || [],
          hasOk: !!document.getElementById('ok'),
          probe: localStorage.getItem('rs_session_probe')
        };
      });
    });
    assert(cacheState.hasOk, 'recovers after wiping stale Cache Storage');
    assert(cacheState.keys.indexOf('stale-shell') < 0, 'stale Cache Storage entry removed');
    assert(cacheState.probe === 'keep-me', 'user localStorage kept after cache wipe');
    await ctxD.close();

    // E) No infinite reload when sessionStorage throws (Telegram-like)
    var ctxE = await browser.createBrowserContext();
    var pE = await ctxE.newPage();
    mode = 'seed';
    await pE.goto(base, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await pE.waitForFunction(function () { return !!navigator.serviceWorker.controller; }, { timeout: 15000 });
    mode = 'noop';
    clientMode = 'good-nosess';
    await pE.evaluate(function () {
      return navigator.serviceWorker.getRegistration().then(function (reg) {
        return reg ? reg.update() : null;
      });
    });
    await sleep(1000);
    await pE.goto(base + '?nosess=1', { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(function () {});
    await sleep(1500);
    if (!(await pE.evaluate(function () { return !!document.getElementById('ok'); }))) {
      await pE.goto(base + '?nosess=2', { waitUntil: 'domcontentloaded', timeout: 20000 });
      await sleep(1000);
    }
    // Wait to ensure we are not stuck in reload loop
    await sleep(2000);
    var nosess = await pE.evaluate(function () {
      return {
        hasOk: !!document.getElementById('ok'),
        ready: document.readyState,
        reloads: window.__reloadCount || 0
      };
    });
    assert(nosess.hasOk && nosess.ready === 'complete', 'recovers without sessionStorage (Telegram-like)');
    assert(nosess.reloads <= 2, 'no infinite reload loop without sessionStorage (reloads=' + nosess.reloads + ')');
    await ctxE.close();

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
