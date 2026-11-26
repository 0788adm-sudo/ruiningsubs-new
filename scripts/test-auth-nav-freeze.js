#!/usr/bin/env node
'use strict';
/**
 * Regression: after login / password recovery the site must not freeze.
 * Root cause: #modal-tg-group.show with opacity:0 + pointer-events:auto when
 * CSS animations are skipped (Telegram / Safari) covered the viewport and
 * ate every tap including bottom nav + Edit profile.
 */
var fs = require('fs');
var path = require('path');
var assert = require('assert');
var {spawn} = require('child_process');
var http = require('http');
var os = require('os');

var root = path.join(__dirname, '..');
var html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

function ok(cond, msg) {
  assert.ok(cond, msg);
  console.log('OK', msg);
}

/* —— Static guards —— */
ok(html.indexOf('function releaseInteractionBlockers(') >= 0, 'releaseInteractionBlockers helper');
ok(/#modal-tg-group\{[^}]*pointer-events:\s*none/.test(html), 'tg-group base has pointer-events:none');
ok(/#modal-tg-group\.show\{[^}]*opacity:\s*1/.test(html), 'tg-group .show sets opacity:1 (not animation-only)');
ok(/#modal-tg-group\.show\{[^}]*pointer-events:\s*auto/.test(html), 'tg-group .show enables pointer-events');
ok(/#modal-tg-group\.hiding\{[^}]*pointer-events:\s*none/.test(html), 'tg-group .hiding disables pointer-events');
ok(/#side-menu-bg\{[^}]*pointer-events:\s*none/.test(html), 'side-menu-bg base has pointer-events:none');
ok(/#side-menu-bg\.show\{[^}]*pointer-events:\s*auto/.test(html), 'side-menu-bg .show enables pointer-events');
ok(html.indexOf("event==='PASSWORD_RECOVERY'") >= 0, 'handles PASSWORD_RECOVERY');
ok(html.indexOf("event==='SIGNED_IN'") >= 0, 'handles SIGNED_IN');
ok(html.indexOf("event==='INITIAL_SESSION'") >= 0, 'handles INITIAL_SESSION');
ok(html.indexOf("event==='TOKEN_REFRESHED'") >= 0, 'handles TOKEN_REFRESHED');
ok(html.indexOf('Never await Supabase/DB here') >= 0 || html.indexOf('keep this callback synchronous') >= 0,
  'auth callback documents no-await rule');
ok(html.indexOf('releaseInteractionBlockers') >= 0 && html.indexOf('doLogin') >= 0,
  'login path references blocker release');
ok(html.indexOf('clearRecoveryModeFlags') >= 0, 'clearRecoveryModeFlags present');

console.log('\nStatic auth-nav freeze checks passed.');

/* —— Headless: invisible tg-group must NOT block nav after CSS fix —— */
var PORT = 4192;
var CHROME = process.env.CHROME_PATH || 'google-chrome';
var WebSocket;
try { WebSocket = require('ws'); } catch (e) {
  console.log('SKIP browser (no ws) — static checks only');
  process.exit(0);
}

function serveOnce() {
  return new Promise(function (resolve, reject) {
    var server = http.createServer(function (req, res) {
      var urlPath = (req.url || '/').split('?')[0].split('#')[0];
      if (urlPath === '/') urlPath = '/index.html';
      var file = path.join(root, decodeURIComponent(urlPath));
      if (!file.startsWith(root)) { res.writeHead(403); res.end('forbidden'); return; }
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

(async function () {
  var server = await serveOnce();
  var tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-navfreeze-'));
  var chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--disable-dev-shm-usage',
    '--user-data-dir=' + tmp, '--remote-debugging-port=9222', 'about:blank'
  ], {stdio: ['ignore', 'pipe', 'pipe']});
  try {
    await waitPort(0);
    var targets = await fetch('http://127.0.0.1:9222/json/list').then(function (r) { return r.json(); });
    var page = targets.find(function (t) { return t.type === 'page'; }) || targets[0];
    var pageWs = new WebSocket(page.webSocketDebuggerUrl);
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
        try{ localStorage.setItem('rs_age_ok','1'); localStorage.setItem('rs_tg_hide_v2','1'); localStorage.setItem('rs_tg_group_hide_v1','1'); }catch(e){}
        try{ if(typeof enterSite==='function' && !document.getElementById('app').classList.contains('show')) enterSite(); }catch(e){}
        await new Promise(r=>setTimeout(r,800));

        // Kill animations (Telegram / Safari failure mode that caused the freeze).
        var style=document.createElement('style');
        style.textContent='*,*::before,*::after{animation:none!important;transition:none!important}';
        document.head.appendChild(style);

        currentUser={name:'navfreeze_user',role:'user',email:'n@test.com',account_type:'registered'};
        localStorage.setItem('rs_uid','navfreeze_user');
        localStorage.setItem('rs_role','user');
        if(typeof syncAuthShell==='function') syncAuthShell();
        if(typeof showPanel==='function') showPanel('profile',{keepScroll:true});

        // Simulate the buggy state: .show while animations are disabled.
        localStorage.removeItem('rs_tg_group_hide_v1');
        var modal=document.getElementById('modal-tg-group');
        modal.classList.remove('hiding');
        modal.classList.add('show');
        modal.setAttribute('aria-hidden','false');
        await new Promise(r=>setTimeout(r,50));

        var st=getComputedStyle(modal);
        var navEl=document.elementFromPoint(window.innerWidth/2, window.innerHeight-28);
        var coversNav = !!(navEl && (navEl.id==='modal-tg-group' || (navEl.closest && navEl.closest('#modal-tg-group'))));

        // Visible invite is OK — opacity must be 1 so the user can see + dismiss it.
        // The freeze bug was opacity:0 while still covering (invisible click shield).
        var opacityOk = parseFloat(st.opacity) >= 0.99;
        var peAuto = st.pointerEvents === 'auto';
        var notInvisibleShield = !(coversNav && parseFloat(st.opacity) < 0.05);

        // After releaseInteractionBlockers(force), nav must be free.
        if(typeof releaseInteractionBlockers==='function') releaseInteractionBlockers({force:true});
        await new Promise(r=>setTimeout(r,30));
        var navEl2=document.elementFromPoint(window.innerWidth/2, window.innerHeight-28);
        var navFree = !!(navEl2 && navEl2.closest && navEl2.closest('.bottom-nav,.nav-row,.nav-item'));
        var modalGone = !modal.classList.contains('show');

        // side-menu ghost: display block without .show must not capture.
        var bg=document.getElementById('side-menu-bg');
        bg.classList.remove('show');
        bg.style.display='block';
        await new Promise(r=>setTimeout(r,20));
        var bgSt=getComputedStyle(bg);
        var bgPeNone = bgSt.pointerEvents === 'none';
        var navEl3=document.elementFromPoint(window.innerWidth/2, window.innerHeight-28);
        var navFreeWithBg = !!(navEl3 && navEl3.closest && navEl3.closest('.bottom-nav,.nav-row,.nav-item'));

        // Nav click still works after simulated login.
        var before=(document.querySelector('.panel.active')||{}).id;
        var wallBtn=document.querySelector('.nav-row [data-p="wall"]');
        if(wallBtn){
          wallBtn.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,clientX:12,clientY:12,pointerId:1,pointerType:'mouse',button:0}));
          wallBtn.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,clientX:12,clientY:12,pointerId:1,pointerType:'mouse',button:0}));
          wallBtn.click();
        }
        await new Promise(r=>setTimeout(r,120));
        var after=(document.querySelector('.panel.active')||{}).id;
        var navWorks = after==='panel-wall' || after!==before;

        return {
          ok: opacityOk && peAuto && notInvisibleShield && navFree && modalGone && bgPeNone && navFreeWithBg && navWorks,
          opacityOk:opacityOk, peAuto:peAuto, notInvisibleShield:notInvisibleShield, coversNav:coversNav,
          navFree:navFree, modalGone:modalGone, bgPeNone:bgPeNone, navFreeWithBg:navFreeWithBg,
          navWorks:navWorks, before:before, after:after, modalOp:st.opacity, modalPe:st.pointerEvents
        };
      })()`
    });
    pageWs.close();
    var out = result && result.result && result.result.value;
    console.log(JSON.stringify(out, null, 2));
    if (!out || !out.ok) {
      console.error('FAIL auth-nav freeze browser check');
      process.exit(1);
    }
    console.log('PASS auth-nav freeze browser check');
  } finally {
    try { chrome.kill('SIGKILL'); } catch (e) {}
    server.close();
    try { fs.rmSync(tmp, {recursive: true, force: true}); } catch (e) {}
  }
})().catch(function (e) {
  console.error(e);
  process.exit(1);
});
