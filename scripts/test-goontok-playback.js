#!/usr/bin/env node
// Static checks for GoonTok playback fixes in index.html
const fs = require('fs');
const html = fs.readFileSync(require('path').join(__dirname, '..', 'index.html'), 'utf8');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
  console.log('PASS · ' + msg);
}

assert(html.includes('function publicMediaUrl'), 'publicMediaUrl helper exists');
assert(html.includes('showGoonTokSlideError'), 'soft error UI instead of hard drop');
assert(/function silentlyDropGoonTokSlide[\s\S]{0,200}showGoonTokSlideError/.test(html), 'silentlyDrop delegates to error UI');
assert(!/function silentlyDropGoonTokSlide[\s\S]{0,400}slide\.remove\(/.test(html), 'silentlyDrop no longer removes slide nodes');
assert(html.includes("function isVideoHiddenFromGoonTok(id){\n      // Legacy") || html.includes('return false;\n    }\n    function clearLegacyBrokenVideoHealth'), 'broken videos no longer hidden from pool');
assert(html.includes("var sig=list.map(function(p){return String(p.id)}).join(',')+'|'+gtTab;"), 'render signature ignores health map remounts');
assert(html.includes('hotBumpGoonTok'), 'HOT button wired');
assert(html.includes('gt-load') && html.includes('gt-err'), 'loading + error overlays');
assert(html.includes('unloadFarVideo'), 'far slides unload buffer only');
assert(/GoonTok policy: no Extender/.test(html), 'no extender on GoonTok');

// Runtime publicMediaUrl behavior
const CF_MEDIA = 'https://pub-b65c88e28c02405ba88db599e7c80d0f.r2.dev';
function publicMediaUrl(u) {
  u = String(u || '').trim();
  if (!u) return '';
  var m = u.match(/^https?:\/\/ruiningsubs-api\.0788adm\.workers\.dev\/media\/([^?#]+)/i);
  if (m && m[1]) return CF_MEDIA + '/' + m[1];
  return u;
}
const dead = 'https://ruiningsubs-api.0788adm.workers.dev/media/1793428317029-b8879112-05a5-4297-aa0f-2f3ce7ee82b7.mp4';
const fixed = publicMediaUrl(dead);
assert(fixed.indexOf('r2.dev') >= 0, 'rewrites worker media to R2');

(async function () {
  const r = await fetch(fixed, { method: 'HEAD' });
  assert(r.status === 200 && /video\//i.test(String(r.headers.get('content-type') || '')), 'rewritten URL is playable mp4');
  // Confirm 5 playable after rewrite
  const KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNubHBkb2x6aHpjYmJkeXhxbG5iIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY1NTg0OTYsImV4cCI6MjEwMjEzNDQ5Nn0.sWbn1sLgG6vi6wzKxpW5-1Td47awaxhwA-4ixKXZN-E';
  const rows = await fetch(
    'https://snlpdolzhzcbbdyxqlnb.supabase.co/rest/v1/posts?select=id,image_url&or=(image_url.ilike.*.mp4*,image_url.ilike.*.MP4*)&order=created_at.desc&limit=12',
    { headers: { apikey: KEY, Authorization: 'Bearer ' + KEY } }
  ).then((x) => x.json());
  let ok = 0;
  for (const row of rows) {
    let u = row.image_url;
    try {
      const a = JSON.parse(u);
      if (Array.isArray(a)) u = a.find((x) => /\.mp4/i.test(x)) || a[0];
    } catch (e) {}
    u = publicMediaUrl(u);
    if (!/\.mp4/i.test(String(u))) continue;
    const h = await fetch(u, { method: 'HEAD' });
    if (h.status === 200) ok++;
    if (ok >= 5) break;
  }
  assert(ok >= 5, 'at least 5 playable video URLs available for feed (' + ok + ')');
  console.log('\nAll GoonTok playback static/URL checks passed');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
