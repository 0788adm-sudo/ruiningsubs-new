#!/usr/bin/env node
'use strict';
/**
 * Multimedia architecture regression guards + live R2/Worker probes.
 */
var fs = require('fs');
var path = require('path');
var html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
var api = fs.readFileSync(path.join(__dirname, '..', 'api', 'videos.js'), 'utf8');

function assert(c, m) {
  if (!c) {
    console.error('FAIL:', m);
    process.exit(1);
  }
  console.log('PASS ·', m);
}

assert(html.includes('function publicMediaUrl'), 'publicMediaUrl exists');
assert(html.includes('function fetchableMediaUrl'), 'fetchableMediaUrl exists (CORS Worker path)');
assert(html.includes('function mediaObjectKey'), 'mediaObjectKey shared parser');
assert(html.includes('function bindLazyVideoEvents'), 'shared lazy video event binder');
assert(html.includes('function lvSetStatus'), 'lv status/error/retry UI');
assert(html.includes('lv-retry'), 'Retry control for failed lazy videos');
assert(html.includes("addEventListener('loadedmetadata'"), 'listens loadedmetadata');
assert(html.includes("addEventListener('canplay'"), 'listens canplay');
assert(html.includes("addEventListener('waiting'"), 'listens waiting');
assert(html.includes("addEventListener('stalled'"), 'listens stalled');
assert(html.includes("addEventListener('error'"), 'listens error');
// #t= fragment hung moov-at-end Wall videos on Preparing forever
assert(
  !/function lazyVideoHtml\([\s\S]{0,900}#t=0\.1/.test(html),
  'lazyVideoHtml no longer forces #t=0.1 preview (moov-at-end hang)'
);
assert(
  !/function warmVideoThumb\([\s\S]{0,1200}src\+#t=0\.1|src\)\+'#t=0\.1'|#t=0\.1'\)/.test(html),
  'warmVideoThumb no longer seeks with media-fragment'
);
assert(
  /function warmVideoThumb[\s\S]{0,2000}preload='metadata'/.test(html),
  'warmVideoThumb uses metadata preload on R2'
);
assert(html.includes('window.__nfImgRetry'), 'image retry helper');
assert(html.includes('fetchableMediaUrl(raw)'), 'img retry falls back to Worker');
assert(html.includes('mode:\'cors\'') || html.includes('mode:"cors"'), 'CORS-aware media fetch');
assert(api.includes('CF_MEDIA') && api.includes('publicMediaUrl'), 'api/videos rewrites to R2');

var CF_MEDIA = 'https://pub-b65c88e28c02405ba88db599e7c80d0f.r2.dev';
var CF_API = 'https://ruiningsubs-api.0788adm.workers.dev';
function mediaObjectKey(u) {
  u = String(u || '').trim();
  var m = u.match(
    /^https?:\/\/(?:ruiningsubs-api\.0788adm\.workers\.dev\/media\/|pub-b65c88e28c02405ba88db599e7c80d0f\.r2\.dev\/)([^?#]+)/i
  );
  return m && m[1] ? decodeURIComponent(m[1]) : '';
}
function publicMediaUrl(u) {
  var key = mediaObjectKey(u);
  return key ? CF_MEDIA + '/' + key : String(u || '');
}
function fetchableMediaUrl(u) {
  var key = mediaObjectKey(u);
  return key ? CF_API + '/media/' + key : String(u || '');
}

var sample =
  'https://ruiningsubs-api.0788adm.workers.dev/media/1794799610248-033f50c8-86d0-4b44-9e02-acbc8b0554ab.mp4';
assert(publicMediaUrl(sample).indexOf('r2.dev') >= 0, 'playback URL → R2');
// fetchableMediaUrl prefers same-origin /api/media (Range+CORS); Worker path remains as fallback in source.
assert(
  html.includes('/api/media?key=') || html.includes("CF_API+'/media/'"),
  'fetchableMediaUrl uses /api/media or Worker CORS path'
);
assert(
  fetchableMediaUrl(sample).indexOf('/media') >= 0 || fetchableMediaUrl(sample).indexOf('workers.dev') >= 0,
  'fetch helper maps object keys to a media path'
);
assert(
  publicMediaUrl(publicMediaUrl(sample)) === publicMediaUrl(sample),
  'publicMediaUrl idempotent'
);

(async function () {
  var play = publicMediaUrl(sample);
  var r2 = await fetch(play, { headers: { Range: 'bytes=0-1', 'User-Agent': 'Mozilla/5.0' } });
  assert(r2.status === 206 || r2.status === 200, 'R2 range/playable status ' + r2.status);
  assert((r2.headers.get('Accept-Ranges') || '').toLowerCase() === 'bytes' || r2.status === 206, 'R2 Accept-Ranges');
  // Same-origin /api/media handler is the CORS+Range fetch path (Worker /media currently 404s).
  var handler = require('../api/media.js');
  var statusCode = 0, headers = {}, body = Buffer.alloc(0);
  await handler(
    {
      method: 'GET',
      query: { key: mediaObjectKey(sample) },
      headers: { range: 'bytes=0-1', origin: 'https://www.ruinexpose.com' },
      url: '/api/media?key=' + encodeURIComponent(mediaObjectKey(sample))
    },
    {
      writeHead: function (c, h) {
        statusCode = c;
        headers = h || {};
      },
      end: function (b) {
        if (b) body = Buffer.isBuffer(b) ? b : Buffer.from(String(b));
      }
    }
  );
  assert(statusCode === 206, 'api/media Range → 206');
  assert(headers['Access-Control-Allow-Origin'] === '*', 'api/media CORS * for fetch');
  assert(body.length === 2, 'api/media ranged body');
  console.log('\nMultimedia audit checks passed');
})().catch(function (e) {
  console.error(e);
  process.exit(1);
});
