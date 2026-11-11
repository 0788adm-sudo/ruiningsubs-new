#!/usr/bin/env node
'use strict';
/**
 * Headless Chrome smoke test for Extend infinite scroll.
 * Seeds 120 timed posts, scrolls/appends, triggers progressive re-renders,
 * and asserts previously painted cards are not wiped.
 */
var { spawn } = require('child_process');
var http = require('http');
var fs = require('fs');
var path = require('path');
var os = require('os');
var WebSocket = require('ws');

function assert(c, m) {
  if (!c) {
    console.error('FAIL:', m);
    process.exit(1);
  }
  console.log('PASS ·', m);
}

function wait(ms) {
  return new Promise(function (r) {
    setTimeout(r, ms);
  });
}

function getJson(url) {
  return new Promise(function (resolve, reject) {
    http
      .get(url, function (res) {
        var b = '';
        res.on('data', function (d) {
          b += d;
        });
        res.on('end', function () {
          try {
            resolve(JSON.parse(b));
          } catch (e) {
            reject(e);
          }
        });
      })
      .on('error', reject);
  });
}

async function waitPort(port, tries) {
  for (var i = 0; i < (tries || 40); i++) {
    try {
      var v = await getJson('http://127.0.0.1:' + port + '/json/version');
      if (v && v.webSocketDebuggerUrl) return v;
    } catch (e) {}
    await wait(250);
  }
  throw new Error('devtools port not ready');
}

function openCdp(url) {
  var id = 0;
  var pending = {};
  var ws = new WebSocket(url);
  var ready = new Promise(function (resolve, reject) {
    ws.on('open', resolve);
    ws.on('error', reject);
  });
  ws.on('message', function (data) {
    var msg = JSON.parse(String(data));
    if (msg.id && pending[msg.id]) {
      if (msg.error) pending[msg.id].reject(new Error(JSON.stringify(msg.error)));
      else pending[msg.id].resolve(msg.result);
      delete pending[msg.id];
    }
  });
  function send(method, params, sessionId) {
    var my = ++id;
    return new Promise(function (resolve, reject) {
      pending[my] = { resolve: resolve, reject: reject };
      var payload = { id: my, method: method, params: params || {} };
      if (sessionId) payload.sessionId = sessionId;
      ws.send(JSON.stringify(payload));
    });
  }
  return ready.then(function () {
    return { ws: ws, send: send };
  });
}

async function main() {
  var chrome =
    process.env.CHROME_PATH ||
    ['/usr/local/bin/google-chrome', '/usr/bin/google-chrome', '/usr/bin/chromium-browser'].find(function (p) {
      try {
        return fs.existsSync(p);
      } catch (e) {
        return false;
      }
    });
  assert(!!chrome, 'chrome binary available');

  // Ensure static server is up
  try {
    await getJson('http://127.0.0.1:8765/');
  } catch (e) {
    // index may not be json; any HTTP response is fine
  }
  await new Promise(function (resolve, reject) {
    http
      .get('http://127.0.0.1:8765/index.html', function (res) {
        res.resume();
        if (res.statusCode === 200) resolve();
        else reject(new Error('static server status ' + res.statusCode));
      })
      .on('error', reject);
  });

  var userData = fs.mkdtempSync(path.join(os.tmpdir(), 'ext-feed-'));
  var port = 9241;
  var chromeProc = spawn(
    chrome,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--user-data-dir=' + userData,
      '--remote-debugging-port=' + port,
      'about:blank'
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] }
  );

  var version = await waitPort(port, 50);
  var browser = await openCdp(version.webSocketDebuggerUrl);

  var created = await browser.send('Target.createTarget', { url: 'about:blank' });
  var attached = await browser.send('Target.attachToTarget', { targetId: created.targetId, flatten: true });
  var sessionId = attached.sessionId;
  assert(!!sessionId, 'attached page session');

  async function send(method, params) {
    return browser.send(method, params, sessionId);
  }

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', {
    width: 390,
    height: 844,
    deviceScaleFactor: 2,
    mobile: true
  });
  await send('Page.navigate', { url: 'http://127.0.0.1:8765/index.html' });
  await wait(3500);

  var result = await send('Runtime.evaluate', {
    awaitPromise: true,
    returnByValue: true,
    expression: `(async function(){
      try{
        localStorage.setItem('rs_age_ok','1');
        var ag=document.getElementById('age-gate'); if(ag) ag.classList.add('hidden');
        var app=document.getElementById('app'); if(app) app.classList.add('show');
      }catch(e){}
      try{ if(typeof showPanel==='function') showPanel('feed'); }catch(e){}
      await new Promise(function(r){setTimeout(r,200)});
      var now=Date.now();
      var seeded=[];
      for(var i=0;i<120;i++){
        seeded.push({
          id:'test_ext_'+i,
          user:'tester'+i,
          title:'Extend test '+i,
          desc:'seed',
          tags:['expose'],
          created:now - i*60000,
          expires:now + (6+i)*3600000,
          views:i, likes:0, extensions:0, extendAmount:360,
          extenders:[], likedBy:[], image:'', images:[], featuredUntil:0,
          savesCount:0, downloadsCount:0, reactions:{}, _cf:true
        });
      }
      posts = seeded.slice();
      window.__feedNetDone = true;
      window.__feedShown = 0;
      window.__feedSig = '';
      if(typeof renderPosts!=='function') return {ok:false, err:'no renderPosts'};
      renderPosts();
      var box=document.getElementById('posts-container');
      function countCards(){
        if(!box)return 0;
        return box.querySelectorAll('article.post, .post').length;
      }
      var firstCount = countCards();
      var shown1 = Number(window.__feedShown||0);
      if(typeof appendFeedPage==='function'){ appendFeedPage(); appendFeedPage(); appendFeedPage(); }
      var midCount = countCards();
      var shown2 = Number(window.__feedShown||0);
      window.scrollTo(0, 2400);
      renderPosts(); // progressive re-paint — must keep cards
      var afterCount = countCards();
      var shown3 = Number(window.__feedShown||0);
      var guard=0;
      while((Number(window.__feedShown||0) < 100) && guard++ < 30){
        if(typeof appendFeedPage==='function') appendFeedPage();
      }
      // Simulate another progressive loadPosts paint at deep scroll
      window.scrollTo(0, 8000);
      renderPosts();
      var deepCount = countCards();
      return {
        ok:true,
        firstCount:firstCount,
        shown1:shown1,
        midCount:midCount,
        shown2:shown2,
        afterCount:afterCount,
        shown3:shown3,
        deepCount:deepCount,
        finalShown:Number(window.__feedShown||0),
        rest:(window.__feedRest||[]).length,
        hasSentinel:!!document.getElementById('feed-more-sentinel')
      };
    })()`
  });

  var v = result && result.result && result.result.value;
  assert(v && v.ok, 'page evaluation ok: ' + JSON.stringify(v || result));
  assert(v.shown1 >= 24, 'initial window >=24, got ' + v.shown1);
  assert(v.shown2 > v.shown1, 'append grows shown (' + v.shown1 + ' -> ' + v.shown2 + ')');
  assert(v.shown3 >= v.shown2, 'progressive renderPosts keeps __feedShown (' + v.shown2 + ' -> ' + v.shown3 + ')');
  assert(v.afterCount >= Math.min(v.midCount, v.shown2), 'DOM not wiped after progressive paint');
  assert(v.finalShown >= 100, 'can paint at least 100 posts, got ' + v.finalShown);
  assert(v.deepCount >= 100, 'DOM keeps >=100 after deep progressive paint, got ' + v.deepCount);

  try {
    browser.ws.close();
  } catch (e) {}
  chromeProc.kill('SIGKILL');
  console.log('\nExtend Chrome scroll smoke passed', JSON.stringify(v));
}

main().catch(function (e) {
  console.error('FAIL:', e && e.stack ? e.stack : e);
  process.exit(1);
});
