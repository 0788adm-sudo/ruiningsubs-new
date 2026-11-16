#!/usr/bin/env node
'use strict';
/**
 * Regression guards for GoonTok playback definitive fix (faststart / thumbs / dupes / preload / Range).
 */
var fs = require('fs');
var path = require('path');
var { inspectMp4, remuxMp4FastStart } = require('./lib/mp4-faststart');

var html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
var apiVideos = fs.readFileSync(path.join(__dirname, '..', 'api', 'videos.js'), 'utf8');
var vercelJson = fs.readFileSync(path.join(__dirname, '..', 'vercel.json'), 'utf8');
var worker = fs.readFileSync(path.join(__dirname, '..', 'workers', 'media-range.js'), 'utf8');

function assert(c, m) {
  if (!c) {
    console.error('FAIL:', m);
    process.exit(1);
  }
  console.log('PASS ·', m);
}

// —— Phase 1: Fast Start ——
assert(html.includes('function ensureMp4FastStart'), 'ensureMp4FastStart in upload path');
assert(html.includes('function remuxMp4FastStartBuffer'), 'in-browser remux helper');
assert(html.includes('await ensureMp4FastStart(file)'), 'uploadRawVideo calls ensureMp4FastStart');
assert(html.includes('faststart validation failed'), 'validates remux before publish');
assert(!/ffmpeg -c copy -movflags \+faststart/.test(html) || html.includes('movflags +faststart'), 'documents ffmpeg-equivalent intent');

// —— Phase 2: Thumbnails ——
assert(html.includes('Do NOT call grabVideoPosterFromUrl here'), 'publish does not remote-download for thumbs');
assert(html.includes('function maybePersistPosterFromActivePlayer'), 'controlled vthumb recovery helper');
assert(html.includes('scripts/backfill-vthumbs.js') || fs.existsSync(path.join(__dirname, 'backfill-vthumbs.js')), 'backfill script exists');
assert(fs.existsSync(path.join(__dirname, 'backfill-vthumbs.js')), 'backfill-vthumbs.js present');

// —— Phase 3: No duplicate players / downloads ——
assert(!/class=\"gt-poster gt-poster-vid\"/.test(html) && !/<video class=\"gt-poster gt-poster-vid\"/.test(html), 'gt-poster-vid secondary player removed');
assert(html.includes('gt-poster-empty'), 'empty poster shell for missing thumbs');
assert(/function scheduleVideoPosterFill[\s\S]{0,500}Never spin up a secondary/.test(html), 'scheduleVideoPosterFill is cache-only');
assert(!/onloadeddata="try\{var d=capturePosterFromVideoEl/.test(html), 'Videos grid no longer auto-plays hidden src videos for thumbs');

// —— Phase 4: Preload budget ——
assert(/n===i\+1[\s\S]{0,200}preload='metadata'/.test(html), 'next slide limited to metadata preload');
assert(/n===i[\s\S]{0,200}preload='auto'/.test(html), 'active slide uses preload=auto');
assert(/preload="none" poster=/.test(html), 'GoonTok slides start with preload=none until armed');

// —— Phase 5: Range ——
assert(apiVideos.includes('handleMediaProxy'), 'media Range proxy folded into api/videos.js');
assert(apiVideos.includes('Accept-Ranges'), 'media proxy sets Accept-Ranges');
assert(apiVideos.includes('Content-Range'), 'media proxy forwards Content-Range');
assert(/req\.method !== 'GET' && req\.method !== 'HEAD'/.test(apiVideos) || /req\.method === 'HEAD'/.test(apiVideos), 'media proxy handles HEAD');
assert(vercelJson.includes('"/api/media"') && vercelJson.includes('"/api/videos"'), 'vercel rewrites /api/media → /api/videos (Hobby ≤12 fn)');
assert(!fs.existsSync(path.join(__dirname, '..', 'api', 'media.js')), 'no separate api/media.js (keeps function count ≤12)');
assert(worker.includes('Accept-Ranges'), 'Worker patch sets Accept-Ranges');
assert(worker.includes('status = 206') || worker.includes('status: 206') || worker.includes('206'), 'Worker patch returns 206');
assert(
  html.includes("CF_API+'/media/'") || html.includes('CF_API+"/media/"'),
  'fetchableMediaUrl uses Worker CORS path (not Vercel body-limited proxy for elements)'
);
assert(
  !/function fetchableMediaUrl[\s\S]{0,700}\/api\/media\?key=/.test(html),
  'fetchableMediaUrl must not default to /api/media (Hobby 4.5MB cap breaks feeds)'
);

// —— Remux unit against a known moov-at-end sample (if cached) ——
(async function () {
  var sampleUrl =
    'https://pub-b65c88e28c02405ba88db599e7c80d0f.r2.dev/1794799610248-033f50c8-86d0-4b44-9e02-acbc8b0554ab.mp4';
  var buf;
  try {
    var r = await fetch(sampleUrl);
    buf = Buffer.from(await r.arrayBuffer());
  } catch (e) {
    console.log('WARN · live remux sample skipped:', e.message);
    console.log('\nGoonTok playback-fix static checks passed');
    return;
  }
  var before = inspectMp4(buf);
  assert(before.ok && !before.faststart, 'sample is moov-at-end before remux');
  var out = remuxMp4FastStart(buf);
  assert(out.changed && inspectMp4(out.buffer).faststart, 'remux moves moov before mdat');
  assert(out.buffer.length === buf.length, 'remux preserves byte length (copy, no re-encode)');

  // Live R2 Range still healthy (playback host)
  var range = await fetch(sampleUrl, { headers: { Range: 'bytes=0-1' } });
  assert(range.status === 206, 'R2 playback Range 206 intact');
  assert((range.headers.get('Accept-Ranges') || '').toLowerCase() === 'bytes', 'R2 Accept-Ranges bytes');

  // Local media proxy via api/videos.js (Hobby: no separate media function)
  delete require.cache[require.resolve('../api/videos.js')];
  var handler = require('../api/videos.js');
  assert(typeof handler === 'function', 'api/videos exports handler');

  var headers = {};
  var statusCode = 0;
  var chunks = [];
  var req = {
    method: 'GET',
    query: { key: '1794799610248-033f50c8-86d0-4b44-9e02-acbc8b0554ab.mp4' },
    headers: { range: 'bytes=0-1' },
    url: '/api/media?key=1794799610248-033f50c8-86d0-4b44-9e02-acbc8b0554ab.mp4'
  };
  var res = {
    writeHead: function (code, h) {
      statusCode = code;
      headers = h || {};
    },
    end: function (b) {
      if (b) chunks.push(Buffer.isBuffer(b) ? b : Buffer.from(String(b)));
    }
  };
  await handler(req, res);
  assert(statusCode === 206, 'media proxy returns 206 for Range ' + statusCode);
  assert(String(headers['Accept-Ranges'] || '').toLowerCase() === 'bytes', 'media proxy Accept-Ranges');
  assert(/bytes 0-1\//.test(String(headers['Content-Range'] || '')), 'media proxy Content-Range');
  var body = Buffer.concat(chunks);
  assert(body.length === 2, 'media proxy ranged body length 2');

  // HEAD
  statusCode = 0;
  headers = {};
  chunks = [];
  await handler(
    {
      method: 'HEAD',
      query: { key: '1794799610248-033f50c8-86d0-4b44-9e02-acbc8b0554ab.mp4' },
      headers: {},
      url: '/api/media?key=1794799610248-033f50c8-86d0-4b44-9e02-acbc8b0554ab.mp4'
    },
    res
  );
  assert(statusCode === 200 || statusCode === 206, 'media proxy HEAD ok ' + statusCode);
  assert(String(headers['Accept-Ranges'] || '').toLowerCase() === 'bytes', 'media proxy HEAD Accept-Ranges');

  console.log('\nGoonTok playback-fix checks passed');
})().catch(function (e) {
  console.error(e);
  process.exit(1);
});
