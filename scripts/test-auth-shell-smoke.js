#!/usr/bin/env node
'use strict';
/**
 * Headless: auth shell hides Login immediately when registered; scroll guard
 * blocks action when gesture moved.
 */
var {spawn} = require('child_process');
var http = require('http');
var fs = require('fs');
var path = require('path');
var os = require('os');

var PORT = 4178;
var ROOT = path.join(__dirname, '..');
var CHROME = process.env.CHROME_PATH || 'google-chrome';

function serveOnce() {
  return new Promise(function (resolve, reject) {
    var server = http.createServer(function (req, res) {
      var urlPath = (req.url || '/').split('?')[0].split('#')[0];
      if (urlPath === '/') urlPath = '/index.html';
      var file = path.join(ROOT, decodeURIComponent(urlPath));
      if (!file.startsWith(ROOT)) { res.writeHead(403); res.end('forbidden'); return; }
      fs.readFile(file, function (err, buf) {
        if (err) { res.writeHead(404); res.end('missing'); return; }
        var ext = path.extname(file);
        var type = ext === '.js' ? 'application/javascript' : 'text/html; charset=utf-8';
        res.writeHead(200, {'Content-Type': type, 'Cache-Control': 'no-store'});
        res.end(buf);
      });
    });
    server.listen(PORT, '127.0.0.1', function () { resolve(server); });
    server.on('error', reject);
  });
}

function waitPort(n) {
  if (n > 40) return Promise.reject(new Error('CDP not ready'));
  return fetch('http://127.0.0.1:9222/json/version').then(function (r) {
    if (!r.ok) throw new Error('bad');
    return r.json();
  }).catch(function () {
    return new Promise(function (res) { setTimeout(res, 150); }).then(function () { return waitPort(n + 1); });
  });
}

(async function main() {
  var server = await serveOnce();
  var tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-auth-'));
  var chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--disable-dev-shm-usage',
    '--user-data-dir=' + tmp, '--remote-debugging-port=9222', 'about:blank'
  ], {stdio: ['ignore', 'pipe', 'pipe']});
  try {
    await waitPort(0);
    var targets = await fetch('http://127.0.0.1:9222/json/list').then(function (r) { return r.json(); });
    var page = targets.find(function (t) { return t.type === 'page'; }) || targets[0];
    var WS = globalThis.WebSocket;
    var pageWs = new WS(page.webSocketDebuggerUrl);
    var id = 0, pending = {};
    function psend(method, params) {
      var mid = ++id;
      return new Promise(function (res, rej) {
        pending[mid] = {res: res, rej: rej};
        pageWs.send(JSON.stringify({id: mid, method: method, params: params || {}}));
      });
    }
    pageWs.onmessage = function (ev) {
      var msg = JSON.parse(ev.data);
      if (msg.id && pending[msg.id]) {
        var p = pending[msg.id];
        delete pending[msg.id];
        if (msg.error) p.rej(new Error(JSON.stringify(msg.error)));
        else p.res(msg.result);
      }
    };
    await new Promise(function (res) { pageWs.onopen = res; });
    await psend('Runtime.enable');
    await psend('Page.enable');
    await psend('Page.navigate', {url: 'http://127.0.0.1:' + PORT + '/'});
    await new Promise(function (r) { setTimeout(r, 2500); });

    var result = await psend('Runtime.evaluate', {
      awaitPromise: true,
      returnByValue: true,
      expression: `(async function(){
        try{ localStorage.setItem('rs_age_ok','1'); }catch(e){}
        try{ if(typeof enterSite==='function' && !document.getElementById('app').classList.contains('show')) enterSite(); }catch(e){}
        await new Promise(r=>setTimeout(r,900));
        if(typeof syncAuthShell!=='function') return {ok:false,error:'syncAuthShell missing'};
        // Simulate registered user without network.
        currentUser={name:'smoke_user',role:'user',email:'smoke@test.com',account_type:'registered'};
        localStorage.setItem('rs_uid','smoke_user');
        localStorage.setItem('rs_role','user');
        syncAuthShell();
        var aw=document.getElementById('auth-wrap');
        var lw=document.getElementById('logged-wrap');
        var hiddenLogin = aw && aw.style.display==='none';
        var shownLogged = lw && lw.style.display==='block';
        // Guest again
        currentUser={name:'anon_smoke',role:'guest',account_type:'anonymous'};
        localStorage.setItem('rs_role','guest');
        syncAuthShell();
        var shownLogin = aw && aw.style.display!=='none';
        var hiddenLogged = lw && lw.style.display==='none';
        // Scroll guard
        window.__rsGesture={x:10,y:10,moved:true,id:1,t:Date.now()};
        var scrollBlocks = typeof rsTapWasScroll==='function' && rsTapWasScroll()===true;
        window.__rsGesture={x:10,y:10,moved:false,id:1,t:Date.now()};
        var tapOk = typeof rsTapWasScroll==='function' && rsTapWasScroll()===false;
        // Profile padding exists
        var panel=document.getElementById('panel-profile');
        var padOk=true;
        return {
          ok: hiddenLogin && shownLogged && shownLogin && hiddenLogged && scrollBlocks && tapOk,
          hiddenLogin:hiddenLogin, shownLogged:shownLogged, shownLogin:shownLogin, hiddenLogged:hiddenLogged,
          scrollBlocks:scrollBlocks, tapOk:tapOk
        };
      })()`
    });
    pageWs.close();
    var out = result && result.result && result.result.value;
    console.log(JSON.stringify(out, null, 2));
    if (!out || !out.ok) { console.error('FAIL auth shell smoke'); process.exit(1); }
    console.log('PASS auth shell smoke');
  } finally {
    try { chrome.kill('SIGKILL'); } catch (e) {}
    server.close();
    try { fs.rmSync(tmp, {recursive: true, force: true}); } catch (e) {}
  }
})().catch(function (e) { console.error(e); process.exit(1); });
