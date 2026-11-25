#!/usr/bin/env node
'use strict';
/**
 * Headless Chrome smoke: recovery form stays interactive after repeated
 * openRecoveryUI calls (the freeze bug). Does not send real emails.
 */
var {spawn} = require('child_process');
var http = require('http');
var fs = require('fs');
var path = require('path');
var os = require('os');

var PORT = 4177;
var ROOT = path.join(__dirname, '..');
var CHROME = process.env.CHROME_PATH || 'google-chrome';

function serveOnce() {
  return new Promise(function (resolve, reject) {
    var server = http.createServer(function (req, res) {
      var urlPath = (req.url || '/').split('?')[0].split('#')[0];
      if (urlPath === '/') urlPath = '/index.html';
      var file = path.join(ROOT, decodeURIComponent(urlPath));
      if (!file.startsWith(ROOT)) {
        res.writeHead(403); res.end('forbidden'); return;
      }
      fs.readFile(file, function (err, buf) {
        if (err) { res.writeHead(404); res.end('missing'); return; }
        var ext = path.extname(file);
        var type = ext === '.js' ? 'application/javascript'
          : ext === '.css' ? 'text/css'
          : 'text/html; charset=utf-8';
        res.writeHead(200, {'Content-Type': type, 'Cache-Control': 'no-store'});
        res.end(buf);
      });
    });
    server.listen(PORT, '127.0.0.1', function () { resolve(server); });
    server.on('error', reject);
  });
}

function runChrome(userDataDir) {
  var evaluate = [
    'localStorage.setItem("rs_age_ok","1");',
    'true'
  ].join('');
  // Use Chrome DevTools Protocol via --dump-dom after injecting via a small runner.
  // Simpler: open page with hash, then use remote debugging.
  return new Promise(function (resolve, reject) {
    var chrome = spawn(CHROME, [
      '--headless=new',
      '--disable-gpu',
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--user-data-dir=' + userDataDir,
      '--remote-debugging-port=9222',
      'about:blank'
    ], {stdio: ['ignore', 'pipe', 'pipe']});

    var ready = false;
    var timer = setTimeout(function () {
      if (!ready) {
        try { chrome.kill('SIGKILL'); } catch (e) {}
        reject(new Error('Chrome did not open debugging port'));
      }
    }, 15000);

    function waitPort(n) {
      if (n > 40) return Promise.reject(new Error('CDP port not ready'));
      return fetch('http://127.0.0.1:9222/json/version').then(function (r) {
        if (!r.ok) throw new Error('bad');
        return r.json();
      }).catch(function () {
        return new Promise(function (res) { setTimeout(res, 150); }).then(function () { return waitPort(n + 1); });
      });
    }

    waitPort(0).then(async function () {
      ready = true;
      clearTimeout(timer);
      var ver = await fetch('http://127.0.0.1:9222/json/version').then(function (r) { return r.json(); });
      var wsUrl = ver.webSocketDebuggerUrl;
      var WS = globalThis.WebSocket;
      if (typeof WS !== 'function') {
        chrome.kill('SIGKILL');
        reject(new Error('No WebSocket in Node — run interactive browser smoke instead'));
        return;
      }

      var ws = new WS(wsUrl);
      var id = 0;
      var pending = {};
      function send(method, params) {
        var mid = ++id;
        return new Promise(function (res, rej) {
          pending[mid] = {res: res, rej: rej};
          ws.send(JSON.stringify({id: mid, method: method, params: params || {}}));
        });
      }
      ws.onmessage = function (ev) {
        var msg = JSON.parse(ev.data);
        if (msg.id && pending[msg.id]) {
          var p = pending[msg.id];
          delete pending[msg.id];
          if (msg.error) p.rej(new Error(JSON.stringify(msg.error)));
          else p.res(msg.result);
        }
      };
      ws.onerror = function (e) { reject(e); };

      await new Promise(function (res) { ws.onopen = res; });
      // Attach to a page target
      var targets = await fetch('http://127.0.0.1:9222/json/list').then(function (r) { return r.json(); });
      var page = targets.find(function (t) { return t.type === 'page'; }) || targets[0];
      if (!page) throw new Error('no page target');

      // Use page WS directly
      ws.close();
      var pageWs = new WS(page.webSocketDebuggerUrl);
      id = 0; pending = {};
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
          // Enter site if still on age gate
          try{ if(typeof enterSite==='function' && !document.getElementById('app').classList.contains('show')) enterSite(); }catch(e){}
          await new Promise(r=>setTimeout(r,800));
          if(typeof openRecoveryUI!=='function') return {ok:false,error:'openRecoveryUI missing'};
          openRecoveryUI({sessionOk:true});
          await new Promise(r=>setTimeout(r,200));
          var p1=document.getElementById('new-password');
          var p2=document.getElementById('new-password2');
          var status=document.getElementById('recovery-session-status');
          if(!p1||!p2) return {ok:false,error:'inputs missing'};
          if(p1.disabled||p1.readOnly||p2.disabled||p2.readOnly) return {ok:false,error:'inputs disabled/readonly'};
          p1.value=''; p2.value='';
          p1.focus();
          p1.value='Secret123';
          p2.value='Secret123';
          // Storm: repeated openRecoveryUI must NOT wipe values or re-disable
          for(var i=0;i<8;i++){ openRecoveryUI({sessionOk:true}); openRecoveryUI(); }
          await new Promise(r=>setTimeout(r,300));
          var kept = p1.value==='Secret123' && p2.value==='Secret123';
          var stillEnabled = !p1.disabled && !p1.readOnly && !p2.disabled && !document.getElementById('btn-save-pass').disabled;
          var verified = status && /Link verified/i.test(status.textContent||'');
          // show/hide
          var tog=document.getElementById('btn-toggle-new-pass');
          if(tog) tog.click();
          var shown = p1.type==='text';
          if(tog) tog.click();
          var hidden = p1.type==='password';
          // mismatch validation
          p2.value='Other999';
          window.__rs_saving_pass=false;
          try{ doSaveNewPassword(); }catch(e){}
          await new Promise(r=>setTimeout(r,50));
          var mismatch = /match/i.test((document.getElementById('auth-status')||{}).textContent||'')
            || /match/i.test((status&&status.textContent)||'')
            || /match/i.test((document.getElementById('toast')||{}).textContent||'');
          // body class
          var mode = document.body.classList.contains('rs-recovery-mode');
          return {
            ok: kept && stillEnabled && verified && shown && hidden && mismatch && mode,
            kept:kept, stillEnabled:stillEnabled, verified:verified, shown:shown, hidden:hidden, mismatch:mismatch, mode:mode,
            statusText:(status&&status.textContent)||'',
            p1:p1.value, disabled:p1.disabled, type:p1.type
          };
        })()`
      });

      pageWs.close();
      chrome.kill('SIGKILL');
      resolve(result && result.result && result.result.value);
    }).catch(function (e) {
      try { chrome.kill('SIGKILL'); } catch (e2) {}
      reject(e);
    });
  });
}

(async function main() {
  var server = await serveOnce();
  var tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-rec-'));
  try {
    var out = await runChrome(tmp);
    console.log(JSON.stringify(out, null, 2));
    if (!out || !out.ok) {
      console.error('FAIL recovery UI smoke');
      process.exit(1);
    }
    console.log('PASS recovery UI smoke');
  } finally {
    server.close();
    try { fs.rmSync(tmp, {recursive: true, force: true}); } catch (e) {}
  }
})().catch(function (e) {
  console.error(e);
  process.exit(1);
});
