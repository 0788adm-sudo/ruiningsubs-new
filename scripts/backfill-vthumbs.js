#!/usr/bin/env node
/**
 * Controlled recovery for old GoonTok posts missing durable vthumb posters.
 *
 * - Does NOT delete videos.
 * - Does NOT rewrite media URLs.
 * - Uses ffmpeg to extract one JPEG frame (no full browser download).
 * - Uploads thumb via Worker sign-upload → R2.
 * - Persists vthumb: tag (+ thumb_url when SB row allows) on the post.
 *
 * Usage:
 *   node scripts/backfill-vthumbs.js --dry --limit 5
 *   node scripts/backfill-vthumbs.js --limit 20
 *   node scripts/backfill-vthumbs.js --id 3014
 */
'use strict';
var fs = require('fs');
var path = require('path');
var os = require('os');
var { spawnSync } = require('child_process');

var KEY =
  process.env.SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNubHBkb2x6aHpjYmJkeXhxbG5iIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY1NTg0OTYsImV4cCI6MjEwMjEzNDQ5Nn0.sWbn1sLgG6vi6wzKxpW5-1Td47awaxhwA-4ixKXZN-E';
var SB = process.env.SUPABASE_URL || 'https://snlpdolzhzcbbdyxqlnb.supabase.co';
var CF_API = process.env.CF_API || 'https://ruiningsubs-api.0788adm.workers.dev';
var CF_MEDIA = 'https://pub-b65c88e28c02405ba88db599e7c80d0f.r2.dev';
var DRY = process.argv.indexOf('--dry') >= 0;
var LIMIT = 10;
var ONLY = '';
for (var i = 0; i < process.argv.length; i++) {
  if (process.argv[i] === '--limit' && process.argv[i + 1]) LIMIT = Number(process.argv[i + 1]) || 10;
  if (process.argv[i] === '--id' && process.argv[i + 1]) ONLY = String(process.argv[i + 1]);
}

function publicMediaUrl(u) {
  u = String(u || '').trim();
  if (!u) return '';
  if (u.charAt(0) === '[') {
    try {
      var a = JSON.parse(u);
      if (Array.isArray(a)) return publicMediaUrl(a[0]);
    } catch (e) {}
  }
  var m = u.match(
    /^https?:\/\/(?:ruiningsubs-api\.0788adm\.workers\.dev\/media\/|pub-b65c88e28c02405ba88db599e7c80d0f\.r2\.dev\/)([^?#]+)/i
  );
  if (m && m[1]) {
    try {
      return CF_MEDIA + '/' + decodeURIComponent(m[1]);
    } catch (e) {
      return CF_MEDIA + '/' + m[1];
    }
  }
  return u;
}

function parseTags(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map(String);
  try {
    var j = JSON.parse(raw);
    return Array.isArray(j) ? j.map(String) : [];
  } catch (e) {
    return String(raw)
      .split(/[,\s]+/)
      .filter(Boolean);
  }
}

function hasVthumb(tags) {
  return parseTags(tags).some(function (t) {
    return String(t).indexOf('vthumb:') === 0;
  });
}

function withVthumb(tags, url) {
  tags = parseTags(tags).filter(function (t) {
    return String(t).indexOf('vthumb:') !== 0;
  });
  if (url) tags.push('vthumb:' + url);
  return tags;
}

async function sb(pathname, opts) {
  opts = opts || {};
  var r = await fetch(SB + pathname, {
    method: opts.method || 'GET',
    headers: Object.assign(
      {
        apikey: KEY,
        Authorization: 'Bearer ' + KEY,
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Prefer: opts.prefer || 'return=representation'
      },
      opts.headers || {}
    ),
    body: opts.body || undefined
  });
  var text = await r.text();
  var data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch (e) {
    data = text;
  }
  if (!r.ok) throw new Error('SB HTTP ' + r.status + ' ' + JSON.stringify(data).slice(0, 200));
  return data;
}

function extractThumb(videoUrl, outJpg) {
  var r = spawnSync(
    'ffmpeg',
    ['-y', '-ss', '0.35', '-i', videoUrl, '-frames:v', '1', '-q:v', '3', outJpg],
    { encoding: 'utf8', timeout: 120000 }
  );
  if (r.status !== 0 || !fs.existsSync(outJpg) || fs.statSync(outJpg).size < 400) {
    throw new Error('ffmpeg thumb failed: ' + (r.stderr || '').slice(-300));
  }
  return outJpg;
}

async function uploadThumb(filePath) {
  var buf = fs.readFileSync(filePath);
  var fname = 'vthumb_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7) + '.jpg';
  var sign = await fetch(CF_API + '/sign-upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename: fname, contentType: 'image/jpeg' })
  }).then(function (x) {
    return x.json();
  });
  if (!sign || !sign.putPath) throw new Error('sign-upload failed');
  var put = await fetch(CF_API + sign.putPath, {
    method: 'PUT',
    headers: { 'Content-Type': 'image/jpeg', 'X-Content-Type': 'image/jpeg' },
    body: buf
  }).then(function (x) {
    return x.json();
  });
  if (!put || !put.url) throw new Error((put && put.error) || 'upload failed');
  return put.url;
}

(async function main() {
  var q =
    '/rest/v1/posts?select=id,image_url,tags,created_at&or=(tags.cs.%7Bvideo%7D,tags.cs.%7Bgoontok%7D)&order=created_at.desc&limit=' +
    encodeURIComponent(String(Math.max(LIMIT * 4, 40)));
  if (ONLY) {
    q = '/rest/v1/posts?select=id,image_url,tags,created_at&id=eq.' + encodeURIComponent(ONLY);
  }
  var rows = await sb(q);
  if (!Array.isArray(rows)) throw new Error('unexpected rows');
  var done = 0,
    skipped = 0,
    failed = 0;
  var tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vthumb-'));
  for (var i = 0; i < rows.length && done < LIMIT; i++) {
    var row = rows[i];
    var src = publicMediaUrl(row.image_url);
    if (!/\.mp4|\.m4v|\.mov|\.webm/i.test(src)) {
      skipped++;
      continue;
    }
    if (hasVthumb(row.tags)) {
      skipped++;
      continue;
    }
    var jpg = path.join(tmp, row.id + '.jpg');
    console.log((DRY ? 'DRY ' : 'FIX ') + row.id, src.slice(0, 80));
    try {
      extractThumb(src, jpg);
      if (DRY) {
        console.log('  thumb bytes', fs.statSync(jpg).size);
        done++;
        continue;
      }
      var url = await uploadThumb(jpg);
      var tags = withVthumb(row.tags, url);
      await sb('/rest/v1/posts?id=eq.' + encodeURIComponent(String(row.id)), {
        method: 'PATCH',
        body: JSON.stringify({ tags: tags })
      });
      console.log('  vthumb', url);
      done++;
    } catch (e) {
      failed++;
      console.error('  FAIL', e.message || e);
    }
  }
  try {
    fs.rmSync(tmp, { recursive: true, force: true });
  } catch (e) {}
  console.log('\nDone. fixed=' + done + ' skipped=' + skipped + ' failed=' + failed + (DRY ? ' (dry-run)' : ''));
})().catch(function (e) {
  console.error(e);
  process.exit(1);
});
