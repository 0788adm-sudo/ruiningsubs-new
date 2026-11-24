#!/usr/bin/env node
'use strict';
/**
 * Headless Chrome: Extend opens on first pointerup and survives the ghost click
 * that Chrome retargets onto the modal backdrop.
 */
var { spawn } = require('child_process');
var http = require('http');
var fs = require('fs');
var path = require('path');
var os = require('os');

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

function findChrome() {
  return (
    process.env.CHROME_PATH ||
    ['/usr/local/bin/google-chrome', '/usr/bin/google-chrome', '/usr/bin/chromium-browser', '/usr/bin/chromium'].find(
      function (p) {
        try {
          return fs.existsSync(p);
        } catch (e) {
          return false;
        }
      }
    )
  );
}

async function main() {
  var chrome = findChrome();
  assert(!!chrome, 'chrome binary available');

  var root = path.join(__dirname, '..');
  var PORT = 8877;
  var server = http.createServer(function (req, res) {
    var u = decodeURIComponent((req.url || '/').split('?')[0]);
    var fp = path.join(root, u === '/' ? 'index.html' : u.replace(/^\//, ''));
    if (!fp.startsWith(root) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) {
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
  await new Promise(function (r) {
    server.listen(PORT, '127.0.0.1', r);
  });

  var userData = fs.mkdtempSync(path.join(os.tmpdir(), 'rx-ext-'));
  var debugPort = 9229;
  var child = spawn(
    chrome,
    [
      '--headless=new',
      '--no-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      '--user-data-dir=' + userData,
      '--remote-debugging-port=' + debugPort,
      'about:blank',
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] }
  );

  var WebSocket;
  try {
    WebSocket = require('ws');
  } catch (e) {
    // Minimal CDP over ws without package: use puppeteer-core if present, else install ws temporarily.
    require('child_process').execSync('npm install --no-save ws@8', { cwd: root, stdio: 'ignore' });
    WebSocket = require(path.join(root, 'node_modules', 'ws'));
  }

  async function waitDevtools() {
    for (var i = 0; i < 40; i++) {
      try {
        var res = await fetch('http://127.0.0.1:' + debugPort + '/json/version');
        var j = await res.json();
        if (j && j.webSocketDebuggerUrl) return j;
      } catch (e) {}
      await wait(250);
    }
    throw new Error('devtools not ready');
  }

  var ver = await waitDevtools();
  var list = await (await fetch('http://127.0.0.1:' + debugPort + '/json/list')).json();
  var page = (list || []).find(function (t) {
    return t.type === 'page' && t.webSocketDebuggerUrl;
  });
  assert(!!page, 'chrome page target');

  var id = 0;
  var pending = {};
  var ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise(function (resolve, reject) {
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
  function send(method, params) {
    var my = ++id;
    return new Promise(function (resolve, reject) {
      pending[my] = { resolve: resolve, reject: reject };
      ws.send(JSON.stringify({ id: my, method: method, params: params || {} }));
    });
  }
  async function evaluate(expression) {
    var r = await send('Runtime.evaluate', {
      expression: expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
    return r.result && r.result.value;
  }

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Page.navigate', { url: 'http://127.0.0.1:' + PORT + '/index.html' });
  await wait(2500);

  var result = await evaluate(`(async function(){
    try{
      localStorage.setItem('rs_age_ok','1');
      localStorage.setItem('age_ok','1');
      var gate=document.getElementById('age-gate');
      if(gate){gate.classList.add('hidden');gate.style.display='none'}
      var app=document.getElementById('app');
      if(app) app.classList.add('show');
    }catch(e){}
    // Ensure a logged-in-ish user for extendUserId
    try{
      if(!window.currentUser) window.currentUser={name:'tester',role:'user'};
      localStorage.setItem('rs_uid','tester');
    }catch(e){}
    window.posts=[{
      id:'extchrome1',
      user:'publisher',
      title:'Extend me',
      desc:'first click',
      tags:['exposed','ext_1440'],
      created:Date.now(),
      expires:Date.now()+8*3600000,
      views:1,likes:0,extensions:0,extendAmount:1440,
      image:'https://placehold.co/400x500/png',
      images:['https://placehold.co/400x500/png']
    }];
    window.loadPosts=async function(){return};
    window.renderPosts=function(){};
    window.fetchExtendCooldownStatus=async function(){return {available:true,remaining_ms:0}};
    try{localStorage.removeItem('rs_ext_cd');localStorage.removeItem('rs_ext_map')}catch(e){}
    if(typeof showPanel==='function') showPanel('feed');
    var box=document.getElementById('posts-container');
    if(box && typeof postCardHtml==='function') box.innerHTML=postCardHtml(window.posts[0], true);
    await new Promise(function(r){setTimeout(r,80)});
    window.__blockFeedTap=0;
    window.__suppressDetailOpen=0;
    window.__suppressModalClose=0;
    var btn=document.querySelector('.btn-extend[data-nf-act="extend"],.btn-extend');
    if(!btn) return {ok:false, reason:'no-btn'};
    var r=btn.getBoundingClientRect();
    var x=r.left+r.width/2, y=r.top+r.height/2;
    function fire(type, target){
      var ev=new PointerEvent(type,{bubbles:true,cancelable:true,clientX:x,clientY:y,pointerType:'touch',button:0,buttons:type==='pointerdown'?1:0});
      target.dispatchEvent(ev);
    }
    fire('pointerdown', btn);
    await new Promise(function(r){setTimeout(r,30)});
    fire('pointerup', btn);
    // Chrome ghost click retargeted onto modal backdrop
    await new Promise(function(r){setTimeout(r,40)});
    var modal=document.getElementById('extend-modal');
    if(modal){
      modal.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,clientX:x,clientY:y}));
    }
    await new Promise(function(r){setTimeout(r,120)});
    var stillOpen=!!(modal && modal.classList.contains('show') && getComputedStyle(modal).display!=='none');
    var armed=btn.classList.contains('is-arming') || true;
    return {
      ok: stillOpen,
      stillOpen: stillOpen,
      currentId: String(window.currentExtendPostId||''),
      suppressModal: Number(window.__suppressModalClose||0)>Date.now(),
      guard: modal && modal.getAttribute('data-ghost-guard'),
      display: modal && modal.style.display,
      classes: modal && modal.className
    };
  })()`);

  console.log('diag', result);
  assert(result && result.ok, 'Extend modal stays open after first tap + Chrome ghost backdrop click');
  assert(result.currentId === 'extchrome1', 'currentExtendPostId set on first tap');
  assert(!!result.suppressModal || result.guard === '1' || result.stillOpen, 'ghost dismiss guard active or modal open');

  try {
    ws.close();
  } catch (e) {}
  try {
    child.kill('SIGKILL');
  } catch (e) {}
  server.close();
  console.log('\nChrome Extend first-click checks passed');
}

main().catch(function (e) {
  console.error('FAIL', e);
  process.exit(1);
});
