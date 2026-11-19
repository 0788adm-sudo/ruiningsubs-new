#!/usr/bin/env node
'use strict';
/**
 * Guards + live probes for GoonTok/Wall slow-playback root fix.
 * Measures real TTFB / first-chunk availability for the repaired roulette clips
 * and three currently-working catalog videos.
 */
var fs = require('fs');
var path = require('path');
var { inspectMp4 } = require('./lib/mp4-faststart');

var html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
var worker = fs.readFileSync(path.join(__dirname, '..', 'workers', 'media-range.js'), 'utf8');
var apiVideos = fs.readFileSync(path.join(__dirname, '..', 'api', 'videos.js'), 'utf8');
var R2 = 'https://pub-b65c88e28c02405ba88db599e7c80d0f.r2.dev';
var WK = 'https://ruiningsubs-api.0788adm.workers.dev/media';
var KEY =
  process.env.SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNubHBkb2x6aHpjYmJkeXhxbG5iIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY1NTg0OTYsImV4cCI6MjEwMjEzNDQ5Nn0.sWbn1sLgG6vi6wzKxpW5-1Td47awaxhwA-4ixKXZN-E';
var SB = 'https://snlpdolzhzcbbdyxqlnb.supabase.co';

function assert(c, m) {
  if (!c) {
    console.error('FAIL:', m);
    process.exit(1);
  }
  console.log('PASS ·', m);
}

function mediaKey(u) {
  var m = String(u || '').match(
    /(?:workers\.dev\/media\/|r2\.dev\/)([^?#]+)/i
  );
  return m ? decodeURIComponent(m[1]) : '';
}

function publicUrl(u) {
  var k = mediaKey(u);
  return k ? R2 + '/' + k : String(u || '');
}

// —— Static guards ——
assert(/async function uploadPostPhotos[\s\S]*ensureMp4FastStart/.test(html), 'uploadPostPhotos applies ensureMp4FastStart');
assert(/async function uploadPostPhotos[\s\S]*grabVideoPoster/.test(html), 'uploadPostPhotos can mint local vthumb');
assert(/hasUploadedVideo[\s\S]{0,400}withVthumbTag/.test(html), 'createPost stamps vthumb for Wall videos');
assert(/busyVid[\s\S]{0,200}lazy-video\[data-lv-active/.test(html), 'optimize worker yields to active players');
assert(/ensureMp4FastStart\(out,\s*\{silent:true\}\)/.test(html), 'background optimize Fast Starts silently');
assert(worker.includes('status: 416') || worker.includes('status = 416') || /416/.test(worker), 'Worker patch handles 416');
assert(worker.includes('Accept-Ranges'), 'Worker patch Accept-Ranges');
assert(apiVideos.includes('status === 416') || apiVideos.includes('416'), 'media proxy forwards 416');
assert(fs.existsSync(path.join(__dirname, 'repair-mp4-faststart.js')), 'repair-mp4-faststart.js present');

(async function () {
  var rows = await fetch(
    SB + '/rest/v1/posts?select=id,image_url,tags,title&id=in.(3122,3111,3040,3014,3001)',
    { headers: { apikey: KEY, Authorization: 'Bearer ' + KEY } }
  ).then(function (r) {
    return r.json();
  });
  assert(Array.isArray(rows) && rows.length >= 4, 'fetched sample posts from Supabase');

  var byId = {};
  rows.forEach(function (r) {
    byId[r.id] = r;
  });

  assert(byId[3122], 'problem roulette post 3122 present');
  assert(
    (byId[3122].tags || []).some(function (t) {
      return String(t).indexOf('vthumb:') === 0;
    }),
    '3122 has durable vthumb'
  );

  var timings = [];
  async function probe(id, label) {
    var row = byId[id];
    assert(row, 'post ' + id + ' present');
    var url = publicUrl(row.image_url);
    var key = mediaKey(row.image_url);
    assert(!!key, id + ' has media key');

    // Cold first-chunk (enough for Fast Start moov)
    var t0 = Date.now();
    var r = await fetch(url, { headers: { Range: 'bytes=0-262143' }, cache: 'no-store' });
    var buf = Buffer.from(await r.arrayBuffer());
    var coldMs = Date.now() - t0;
    assert(r.status === 206, id + ' R2 Range 206 (got ' + r.status + ')');
    assert((r.headers.get('Accept-Ranges') || '').toLowerCase() === 'bytes', id + ' Accept-Ranges');
    assert(/^bytes 0-/.test(r.headers.get('Content-Range') || ''), id + ' Content-Range');
    assert(buf.length > 0 && buf.length <= 262144, id + ' ranged body not full file');

    // Inspect: for repaired clips, moov must be in the first chunk
    var infoHead = inspectMp4(buf);
    var full = null;
    var fullInfo = null;
    if (!infoHead.faststart) {
      // May need full file to confirm (moov-at-end catalog clips)
      full = Buffer.from(await (await fetch(url)).arrayBuffer());
      fullInfo = inspectMp4(full);
    }

    var t1 = Date.now();
    var warm = await fetch(url, { headers: { Range: 'bytes=0-65535' } });
    await warm.arrayBuffer();
    var warmMs = Date.now() - t1;

    // Worker must NOT be used as the <video> host, but probe its current Range behavior.
    var tw = Date.now();
    var wr = await fetch(WK + '/' + key, { headers: { Range: 'bytes=0-1' } });
    var wbuf = Buffer.from(await wr.arrayBuffer());
    var workerMs = Date.now() - tw;
    var workerOkRange = wr.status === 206 && wbuf.length === 2;
    // Document current Worker state — do not fail the suite if dashboard patch not deployed yet.
    console.log(
      'INFO · Worker Range for',
      id,
      'status',
      wr.status,
      'body',
      wbuf.length,
      'ms',
      workerMs,
      workerOkRange ? '(206 ok)' : '(STILL FULL/200 — deploy workers/media-range.js)'
    );

    var rowOut = {
      id: id,
      label: label,
      title: row.title,
      key: key,
      coldFirstChunkMs: coldMs,
      warmFirstChunkMs: warmMs,
      firstChunkBytes: buf.length,
      faststartInFirstChunk: !!infoHead.faststart || !!(infoHead.moov && infoHead.moov.offset < 262144),
      fileFaststart: infoHead.faststart || (fullInfo && fullInfo.faststart) || false,
      contentType: r.headers.get('Content-Type'),
      contentRange: r.headers.get('Content-Range'),
      hasVthumb: (row.tags || []).some(function (t) {
        return String(t).indexOf('vthumb:') === 0;
      }),
      workerRangeOk: workerOkRange
    };
    // Heuristic "time until metadata available" for Fast Start = cold first chunk.
    // For moov-at-end, metadata requires nearly full download — record that separately.
    if (rowOut.fileFaststart) {
      rowOut.estimatedMetadataMs = coldMs;
    } else if (full) {
      rowOut.estimatedMetadataMs = null;
      rowOut.fullDownloadBytes = full.length;
      rowOut.note = 'moov-at-end (catalog clip still playable via R2 Range seek)';
    }
    timings.push(rowOut);
    console.log('TIME ·', JSON.stringify(rowOut));
    return rowOut;
  }

  var p3122 = await probe(3122, 'roulette-problem-repaired');
  assert(p3122.fileFaststart || p3122.faststartInFirstChunk, '3122 is Fast Start after repair');
  assert(p3122.coldFirstChunkMs < 5000, '3122 first chunk < 5s (got ' + p3122.coldFirstChunkMs + 'ms)');

  var p3111 = await probe(3111, 'roulette-beg-repaired');
  assert(p3111.fileFaststart || p3111.faststartInFirstChunk, '3111 is Fast Start after repair');

  await probe(3040, 'working-3040');
  await probe(3014, 'working-3014');
  await probe(3001, 'working-3001');

  // Quick consecutive Range navigation simulation (active + next only)
  var navIds = [3122, 3040, 3014, 3001];
  var nav = [];
  for (var i = 0; i < navIds.length; i++) {
    var row = byId[navIds[i]];
    var url = publicUrl(row.image_url);
    var t = Date.now();
    var rr = await fetch(url, { headers: { Range: 'bytes=0-131071' }, cache: 'no-store' });
    var bb = Buffer.from(await rr.arrayBuffer());
    nav.push({ id: navIds[i], ms: Date.now() - t, status: rr.status, bytes: bb.length });
  }
  console.log('NAV ·', JSON.stringify(nav));
  nav.forEach(function (n) {
    assert(n.status === 206, 'nav ' + n.id + ' 206');
    assert(n.bytes <= 131072, 'nav ' + n.id + ' not full download');
  });

  console.log('\nTIMINGS_JSON');
  console.log(JSON.stringify(timings, null, 2));
  console.log('\nGoonTok slow-rootfix checks passed');
})().catch(function (e) {
  console.error(e);
  process.exit(1);
});
