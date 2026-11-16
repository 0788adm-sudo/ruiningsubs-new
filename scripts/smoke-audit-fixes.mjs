#!/usr/bin/env node
/**
 * Headless Chrome smoke for controlled audit fixes.
 */
import { spawn } from 'child_process';
import http from 'http';
import https from 'https';
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const BASE = process.env.SMOKE_BASE || 'http://127.0.0.1:4173';
const OUT = '/opt/cursor/artifacts';
fs.mkdirSync(OUT, { recursive: true });
const fails = [];
function assert(c, m) {
  if (!c) { console.error('FAIL', m); fails.push(m); }
  else console.log('PASS', m);
}
function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }
function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let b = '';
      res.on('data', (d) => (b += d));
      res.on('end', () => {
        try { resolve(JSON.parse(b)); } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}
function getHttps(url) {
  return new Promise((resolve) => {
    https.get(url, { timeout: 15000 }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({
        status: res.statusCode,
        etag: String(res.headers.etag || '').replace(/"/g, ''),
        bytes: Buffer.concat(chunks).length
      }));
    }).on('error', (e) => resolve({ error: String(e.message || e) }));
  });
}
function loadWs() {
  try { return require('/workspace/node_modules/ws'); }
  catch (e) { return require('ws'); }
}

async function chromeEval(js, viewport) {
  const WebSocket = loadWs();
  const userData = fs.mkdtempSync('/tmp/rs-chrome-');
  const port = 9300 + Math.floor(Math.random() * 500);
  const chrome = spawn('google-chrome', [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--disable-dev-shm-usage',
    `--user-data-dir=${userData}`,
    `--remote-debugging-port=${port}`,
    `--window-size=${viewport.width},${viewport.height}`,
    BASE + (js.path || '/')
  ], { stdio: ['ignore', 'pipe', 'pipe'] });

  try {
    let page = null;
    for (let i = 0; i < 30; i++) {
      await wait(250);
      try {
        const targets = await getJson(`http://127.0.0.1:${port}/json/list`);
        page = targets.find((t) => t.type === 'page' && String(t.url || '').includes('4173'))
          || targets.find((t) => t.type === 'page');
        if (page && page.webSocketDebuggerUrl) break;
      } catch (e) {}
    }
    if (!page) throw new Error('no page target');

    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.once('open', res); ws.once('error', rej); });
    let id = 0;
    const pending = new Map();
    ws.on('message', (raw) => {
      const msg = JSON.parse(String(raw));
      if (msg.id && pending.has(msg.id)) pending.get(msg.id)(msg);
    });
    function send(method, params) {
      const mid = ++id;
      return new Promise((resolve) => {
        pending.set(mid, (msg) => { pending.delete(mid); resolve(msg); });
        ws.send(JSON.stringify({ id: mid, method, params }));
      });
    }
    await send('Runtime.enable');
    await send('Page.enable');
    await send('Emulation.setDeviceMetricsOverride', {
      width: viewport.width,
      height: viewport.height,
      deviceScaleFactor: 1,
      mobile: viewport.width < 800
    });
    // Reload at requested metrics so layout matches viewport
    await send('Page.reload', { ignoreCache: true });
    await wait(js.wait || 5000);
    const r = await send('Runtime.evaluate', {
      expression: js.expr,
      awaitPromise: true,
      returnByValue: true
    });
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    if (shot.result && shot.result.data) {
      fs.writeFileSync(path.join(OUT, js.shot || 'shot.png'), Buffer.from(shot.result.data, 'base64'));
    }
    ws.close();
    chrome.kill();
    if (r.result && r.result.exceptionDetails) {
      return { error: JSON.stringify(r.result.exceptionDetails) };
    }
    return { value: r.result && r.result.result && r.result.result.value };
  } catch (e) {
    try { chrome.kill(); } catch (_) {}
    return { error: String(e.message || e) };
  }
}

const carto = await getHttps('https://a.basemaps.cartocdn.com/dark_all/3/2/3.png');
const esri = await getHttps('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/3/3/2');
assert(String(carto.etag || '').startsWith('wm-'), 'live CARTO still watermarked (wm- etag=' + carto.etag + ')');
assert(esri.status === 200 && esri.bytes > 3000, 'live Esri dark tiles OK (' + esri.bytes + ' bytes)');

const desktop = await chromeEval({
  path: '/',
  wait: 6500,
  shot: 'audit-desktop-extend-map.png',
  expr: `(async()=>{
    const out={};
    try{ if(window.enterSite) enterSite(); else { var g=document.getElementById('age-gate'); if(g)g.classList.add('hidden'); var a=document.getElementById('app'); if(a)a.classList.add('show'); } }catch(e){}
    await new Promise(r=>setTimeout(r,400));
    try{ if(window.showPanel) showPanel('feed'); }catch(e){}
    await new Promise(r=>setTimeout(r,900));
    try{ if(window.fillHomeRandomStrip) fillHomeRandomStrip(); }catch(e){}
    await new Promise(r=>setTimeout(r,800));
    // Measure while feed is active — hidden panels report 0x0 rects.
    const cards=[...document.querySelectorAll('#home-random-strip .home-strip-card:not(.is-broken)')];
    out.widths=cards.map(c=>Math.round(c.getBoundingClientRect().width));
    out.stripCount=cards.length;
    out.stripMaxCss=(()=>{try{const el=cards[0]; if(!el)return null; return getComputedStyle(el).maxWidth}catch(e){return null}})();
    try{ showPanel('explore'); }catch(e){}
    await new Promise(r=>setTimeout(r,900));
    out.openGamesBtns=[...document.querySelectorAll('#panel-explore button, #panel-explore .tasks-entry, #explore-xp-promo *')].filter(el=>/\\bOpen games\\b/i.test(el.textContent||'')).length;
    out.gamesEntry=!!document.getElementById('btn-explore-games');
    out.gamesLabel=(document.querySelector('#btn-explore-games strong')||{}).textContent||'';
    try{ openRandomCam(); }catch(e){ try{showPanel('randomcam')}catch(e2){} }
    await new Promise(r=>setTimeout(r,700));
    const soonEl=document.getElementById('rc-coming-soon');
    out.soon=!!soonEl && !soonEl.hidden;
    out.soonText=(soonEl&&soonEl.textContent||'').replace(/\\s+/g,' ').trim().slice(0,140);
    out.startDis=!!(document.getElementById('rc-start')&&document.getElementById('rc-start').disabled);
    try{ startRandomCam(); }catch(e){}
    await new Promise(r=>setTimeout(r,500));
    out.progressAfterStart=!!document.querySelector('#video-upload-progress.show');
    out.localSrc=!!(document.getElementById('rc-local')&&document.getElementById('rc-local').srcObject);
    // Screenshot Random Cam coming soon before leaving
    out._shotRc=true;
    try{ if(window.openExposureMap) await openExposureMap(); else showPanel('map'); }catch(e){ try{showPanel('map')}catch(e2){} }
    await new Promise(r=>setTimeout(r,4500));
    out.progressAfterMap=!!document.querySelector('#video-upload-progress.show');
    out.tileSrcs=[...document.querySelectorAll('#rs-map .leaflet-tile, #rs-map img.leaflet-tile')].map(img=>img.src||'').filter(Boolean).slice(0,8);
    out.cartoTiles=out.tileSrcs.filter(s=>/cartocdn|basemaps\\.carto/i.test(s)).length;
    out.esriTiles=out.tileSrcs.filter(s=>/arcgisonline|World_Dark_Gray/i.test(s)).length;
    out.vw=window.innerWidth;
    out.ageHidden=!!(document.getElementById('age-gate')&&document.getElementById('age-gate').classList.contains('hidden'));
    return out;
  })()`
}, { width: 1280, height: 900 });

if (desktop.error) assert(false, 'desktop eval: ' + desktop.error);
else {
  const v = desktop.value || {};
  console.log('DESKTOP', JSON.stringify(v, null, 2));
  assert(v.vw >= 1200, 'desktop viewport');
  if (v.widths && v.widths.some((w) => w > 0)) {
    assert(v.widths.filter((w) => w > 0).every((w) => w >= 110), 'desktop strip cards enlarged: ' + v.widths.join(','));
  } else if (v.stripMaxCss) {
    // Fallback: computed max-width from desktop media query (168px / none of 96px)
    const n = parseFloat(v.stripMaxCss);
    assert(v.stripMaxCss !== '96px' && (!isNaN(n) ? n >= 150 : true), 'desktop strip max-width CSS: ' + v.stripMaxCss);
  } else {
    console.log('WARN desktop strip empty (network/feed) — CSS covered by static tests');
  }
  assert(v.gamesEntry === true, 'Games entry present');
  assert(v.gamesLabel === 'Games', 'Games label exact');
  assert(v.openGamesBtns === 0, 'no Open games duplicate');
  assert(v.soon === true, 'coming soon overlay visible');
  assert(/Próximamente/i.test(v.soonText || ''), 'coming soon copy');
  assert(v.startDis === true, 'Start disabled');
  assert(v.localSrc === false, 'camera stream not attached');
  assert(v.progressAfterStart === false, 'no compress modal after gated Start');
  assert(v.progressAfterMap === false, 'no compress modal on Map after Random Cam');
  assert(v.cartoTiles === 0, 'no Carto tile URLs in map');
  assert(v.esriTiles > 0, 'Esri tile URLs loaded on map (' + v.esriTiles + ')');
}

const rcShot = await chromeEval({
  path: '/',
  wait: 4000,
  shot: 'audit-randomcam-coming-soon.png',
  expr: `(async()=>{
    try{ if(window.enterSite) enterSite(); }catch(e){}
    await new Promise(r=>setTimeout(r,300));
    try{ openRandomCam(); }catch(e){ showPanel('randomcam'); }
    await new Promise(r=>setTimeout(r,700));
    return {
      soon: !!(document.getElementById('rc-coming-soon') && !document.getElementById('rc-coming-soon').hidden),
      ageHidden: !!(document.getElementById('age-gate') && document.getElementById('age-gate').classList.contains('hidden'))
    };
  })()`
}, { width: 1280, height: 900 });
if (rcShot.error) assert(false, 'rc shot: ' + rcShot.error);
else {
  console.log('RC_SHOT', JSON.stringify(rcShot.value));
  assert(rcShot.value && rcShot.value.soon === true, 'RC screenshot state has coming soon');
}

const mobile = await chromeEval({
  path: '/',
  wait: 5500,
  shot: 'audit-mobile-extend-strip.png',
  expr: `(async()=>{
    try{ if(window.enterSite) enterSite(); else { var g=document.getElementById('age-gate'); if(g)g.classList.add('hidden'); var a=document.getElementById('app'); if(a)a.classList.add('show'); } }catch(e){}
    await new Promise(r=>setTimeout(r,400));
    try{ showPanel('feed'); }catch(e){}
    await new Promise(r=>setTimeout(r,900));
    try{ fillHomeRandomStrip(); }catch(e){}
    await new Promise(r=>setTimeout(r,700));
    const cards=[...document.querySelectorAll('#home-random-strip .home-strip-card')];
    const el=cards[0];
    return {
      widths: cards.map(c=>Math.round(c.getBoundingClientRect().width)),
      maxCss: el?getComputedStyle(el).maxWidth:null,
      flexCss: el?getComputedStyle(el).flex:null,
      vw: window.innerWidth
    };
  })()`
}, { width: 390, height: 844 });

if (mobile.error) assert(false, 'mobile eval: ' + mobile.error);
else {
  const v = mobile.value || {};
  console.log('MOBILE', JSON.stringify(v));
  if (v.widths && v.widths.some((w) => w > 0)) {
    assert(v.widths.filter((w) => w > 0).every((w) => w <= 100), 'mobile strip still small: ' + v.widths.join(','));
  } else if (v.maxCss) {
    assert(v.maxCss === '96px', 'mobile strip max-width remains 96px (got ' + v.maxCss + ')');
  } else {
    console.log('WARN mobile strip empty — CSS covered by static tests');
  }
}

if (fails.length) {
  console.error('\nSmoke failed:', fails.length);
  process.exit(1);
}
console.log('\nSmoke audit fixes passed');
console.log('Artifacts:', OUT);
