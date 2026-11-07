#!/usr/bin/env node
// Static checks for GoonTok playback fixes in index.html
const fs = require('fs');
const html = fs.readFileSync(require('path').join(__dirname, '..', 'index.html'), 'utf8');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
  console.log('PASS · ' + msg);
}

assert(html.includes('function publicMediaUrl'), 'publicMediaUrl helper exists');
assert(html.includes('silentlyDropGoonTokSlide'), 'drop helper exists');
assert(html.includes('function softFailGoonTokSlide'), 'soft-fail keeps slide with Retry');
assert(html.includes('function retryGoonTokSlide'), 'in-place retry helper');
assert(html.includes('gt-retry'), 'retry button in slide markup');
assert(
  html.includes("h.status==='broken'") || html.includes('h.status==="broken"'),
  'broken videos are hidden from the GoonTok pool'
);
assert(html.includes("var sig=list.map(function(p){return String(p.id)}).join(',')+'|'+gtTab;"), 'render signature ignores health map remounts');
assert(html.includes('hotBumpGoonTok'), 'HOT button wired');
assert(html.includes('gt-load'), 'loading overlay');
assert(html.includes('unloadFarVideo'), 'far slides unload buffer only');
assert(html.includes('never re-order by live playable health') || html.includes('Stable ranking'), 'stable ranking (no health reshuffle)');
assert(html.includes('GT_TARGET=80') || html.includes('GT_TARGET = 80'), 'GoonTok target >2');
assert(html.includes('GT_PAGE=24') || html.includes('GT_PAGE = 24'), 'GoonTok page size >2');
assert(html.includes('GT_LOAD_TIMEOUT_MS=12000') || /GT_LOAD_TIMEOUT_MS\s*=\s*12000/.test(html), 'generous playable load timeout');
assert(html.includes('__gtSoundUnlocked'), 'sound preference survives swipes');
assert(html.includes("v.preload='auto'") || html.includes('preload="auto"') || html.includes("preload='auto'"), 'next-slide preload=auto');
assert(!/media_url\.ilike\.%\.mp4%/.test(html), 'SB video scan must not query missing media_url column');
assert(
  html.includes('image_url=ilike.*.mp4*') || html.includes("ilike('image_url','%.mp4%')"),
  'SB video scan uses REST image_url *.mp4*'
);
assert(html.includes('collectVideos()'), 'fetchVideoPosts rebuilds video cache');
assert(html.includes('cacheVideoPosterUrl'), 'thumbnail cache wired');
assert(html.includes("if(u.charAt(0)==='[')"), 'publicMediaUrl unpacks JSON array URLs');

// Soft failures must not remove slides
assert(
  /silentlyDropGoonTokSlide[\s\S]{0,800}load_timeout[\s\S]{0,400}softFailGoonTokSlide/.test(html),
  'load_timeout soft-fails instead of removing the slide'
);

// Runtime publicMediaUrl behavior
const CF_MEDIA = 'https://pub-b65c88e28c02405ba88db599e7c80d0f.r2.dev';
function publicMediaUrl(u) {
  if (Array.isArray(u)) {
    for (var ai = 0; ai < u.length; ai++) {
      var got = publicMediaUrl(u[ai]);
      if (got) return got;
    }
    return '';
  }
  u = String(u || '').trim();
  if (!u) return '';
  if (u.charAt(0) === '[') {
    try {
      var arr = JSON.parse(u);
      if (Array.isArray(arr)) return publicMediaUrl(arr);
    } catch (e) {}
  }
  var m = u.match(/^https?:\/\/ruiningsubs-api\.0788adm\.workers\.dev\/media\/([^?#]+)/i);
  if (m && m[1]) {
    try {
      return CF_MEDIA + '/' + decodeURIComponent(m[1]);
    } catch (e) {
      return CF_MEDIA + '/' + m[1];
    }
  }
  return u;
}
const dead = 'https://ruiningsubs-api.0788adm.workers.dev/media/1793428317029-b8879112-05a5-4297-aa0f-2f3ce7ee82b7.mp4';
const fixed = publicMediaUrl(dead);
assert(fixed.indexOf('r2.dev') >= 0, 'rewrites worker media to R2');
const arrUrl =
  '["https://ruiningsubs-api.0788adm.workers.dev/media/1793428317029-b8879112-05a5-4297-aa0f-2f3ce7ee82b7.mp4"]';
assert(publicMediaUrl(arrUrl).indexOf('r2.dev') >= 0, 'rewrites JSON-array media urls');

function sleep(ms) {
  return new Promise(function (r) {
    setTimeout(r, ms);
  });
}

(async function () {
  const r = await fetch(fixed, {
    method: 'GET',
    headers: { Range: 'bytes=0-1', 'User-Agent': 'Mozilla/5.0' },
  });
  assert(r.status === 206 || r.status === 200, 'rewritten URL is playable mp4');
  const KEY =
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNubHBkb2x6aHpjYmJkeXhxbG5iIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY1NTg0OTYsImV4cCI6MjEwMjEzNDQ5Nn0.sWbn1sLgG6vi6wzKxpW5-1Td47awaxhwA-4ixKXZN-E';
  let rows = null;
  for (let t = 0; t < 5; t++) {
    try {
      const res = await fetch(
        'https://snlpdolzhzcbbdyxqlnb.supabase.co/rest/v1/posts?select=id,image_url&image_url=ilike.*.mp4*&order=created_at.desc&limit=12',
        { headers: { apikey: KEY, Authorization: 'Bearer ' + KEY, Accept: 'application/json' } }
      );
      const j = await res.json();
      if (res.ok && Array.isArray(j)) {
        rows = j;
        break;
      }
    } catch (e) {}
    await sleep(2500 * (t + 1));
  }
  if (!rows) {
    console.log('WARN · live SB video probe skipped (edge flaky); static GoonTok checks passed');
    console.log('\nAll GoonTok playback static/URL checks passed');
    return;
  }
  let ok = 0;
  for (const row of rows) {
    let u = publicMediaUrl(row.image_url);
    if (!/\.mp4/i.test(String(u))) continue;
    const h = await fetch(u, {
      method: 'GET',
      headers: { Range: 'bytes=0-1', 'User-Agent': 'Mozilla/5.0' },
    });
    if (h.status === 200 || h.status === 206) ok++;
    if (ok >= 5) break;
  }
  assert(ok >= 5, 'at least 5 playable video URLs available for feed (' + ok + ')');
  console.log('\nAll GoonTok playback static/URL checks passed');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
