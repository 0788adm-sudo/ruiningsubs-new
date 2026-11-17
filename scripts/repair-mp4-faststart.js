#!/usr/bin/env node
/**
 * Remux moov-at-end MP4s already on R2 → Fast Start, re-upload, patch post image_url.
 * Also extracts a durable JPEG vthumb when missing.
 *
 * SAFETY:
 * - Never deletes the original object (new key uploaded).
 * - Only rewrites posts that still point at the old key.
 * - Dry-run by default with --dry.
 *
 * Usage:
 *   node scripts/repair-mp4-faststart.js --dry --id 3122
 *   node scripts/repair-mp4-faststart.js --id 3122 --id 3111
 *   node scripts/repair-mp4-faststart.js --limit 8
 */
'use strict';
var fs = require('fs');
var os = require('os');
var path = require('path');
var { spawnSync } = require('child_process');
var { inspectMp4, remuxMp4FastStart } = require('./lib/mp4-faststart');

var KEY =
  process.env.SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNubHBkb2x6aHpjYmJkeXhxbG5iIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY1NTg0OTYsImV4cCI6MjEwMjEzNDQ5Nn0.sWbn1sLgG6vi6wzKxpW5-1Td47awaxhwA-4ixKXZN-E';
var SB = process.env.SUPABASE_URL || 'https://snlpdolzhzcbbdyxqlnb.supabase.co';
var CF_API = process.env.CF_API || 'https://ruiningsubs-api.0788adm.workers.dev';
var CF_MEDIA = 'https://pub-b65c88e28c02405ba88db599e7c80d0f.r2.dev';
var DRY = process.argv.indexOf('--dry') >= 0;
var LIMIT = 5;
var ONLY = [];
for (var i = 0; i < process.argv.length; i++) {
  if (process.argv[i] === '--limit' && process.argv[i + 1]) LIMIT = Number(process.argv[i + 1]) || 5;
  if (process.argv[i] === '--id' && process.argv[i + 1]) ONLY.push(String(process.argv[i + 1]));
}

function publicMediaUrl(u) {
  u = String(u || '').trim();
  if (!u) return '';
  if (u.charAt(0) === '[') {
    try {
      var a = JSON.parse(u);
      if (Array.isArray(a)) {
        for (var j = 0; j < a.length; j++) {
          var g = publicMediaUrl(a[j]);
          if (g) return g;
        }
      }
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

function mediaKey(u) {
  u = publicMediaUrl(u);
  var m = String(u).match(/\/([^\/?#]+\.mp4)(\?|#|$)/i);
  return m ? m[1] : '';
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
  if (url) tags.push('vthumb:' + publicMediaUrl(url));
  return tags;
}

async function sb(pathSuffix, opts) {
  opts = opts || {};
  var r = await fetch(SB + pathSuffix, {
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
  if (!r.ok) throw new Error('SB HTTP ' + r.status + ' ' + String(text).slice(0, 200));
  return data;
}

async function uploadBytes(buf, filename, contentType) {
  var sign = await fetch(CF_API + '/sign-upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename: filename, contentType: contentType })
  }).then(function (r) {
    return r.json();
  });
  if (!sign || !sign.putPath) throw new Error('sign failed');
  var put = await fetch(CF_API + sign.putPath, {
    method: 'PUT',
    headers: { 'Content-Type': contentType, 'X-Content-Type': contentType },
    body: buf
  }).then(function (r) {
    return r.json();
  });
  if (!put || !put.url) throw new Error((put && put.error) || 'upload failed');
  return put.url;
}

function extractThumb(mp4Path) {
  var out = path.join(os.tmpdir(), 'vthumb_' + Date.now() + '.jpg');
  var r = spawnSync(
    'ffmpeg',
    ['-y', '-ss', '0.4', '-i', mp4Path, '-frames:v', '1', '-q:v', '3', out],
    { encoding: 'utf8' }
  );
  if (r.status !== 0 || !fs.existsSync(out)) return null;
  return out;
}

async function repairRow(row) {
  var id = row.id;
  var url = publicMediaUrl(row.image_url);
  var key = mediaKey(url);
  if (!key) {
    console.log('SKIP', id, 'no mp4 key');
    return { id: id, skipped: true, reason: 'no_key' };
  }
  console.log('FETCH', id, key);
  var t0 = Date.now();
  var res = await fetch(CF_MEDIA + '/' + key);
  if (!res.ok) throw new Error('download ' + res.status);
  var buf = Buffer.from(await res.arrayBuffer());
  var before = inspectMp4(buf);
  console.log(
    '  size',
    buf.length,
    'faststart',
    !!before.faststart,
    'boxes',
    (before.types || []).join(','),
    'dlMs',
    Date.now() - t0
  );
  if (!before.ok) return { id: id, skipped: true, reason: 'bad_mp4' };

  var outBuf = buf;
  var changed = false;
  if (!before.faststart) {
    var remuxed = remuxMp4FastStart(buf);
    if (!remuxed.changed || !inspectMp4(remuxed.buffer).faststart) {
      console.log('  remux failed — leaving original');
      return { id: id, skipped: true, reason: 'remux_fail' };
    }
    outBuf = Buffer.from(remuxed.buffer);
    changed = true;
    console.log('  remuxed Fast Start ok');
  } else {
    console.log('  already Fast Start');
  }

  var tags = parseTags(row.tags);
  var thumbUrl = '';
  var needThumb = !hasVthumb(tags);
  var tmpMp4 = path.join(os.tmpdir(), 'repair_' + id + '.mp4');
  fs.writeFileSync(tmpMp4, outBuf);
  if (needThumb) {
    var jpg = extractThumb(tmpMp4);
    if (jpg) {
      if (!DRY) {
        thumbUrl = await uploadBytes(fs.readFileSync(jpg), 'vthumb_' + id + '_' + Date.now() + '.jpg', 'image/jpeg');
        console.log('  vthumb', thumbUrl);
      } else {
        console.log('  DRY vthumb would upload', jpg, fs.statSync(jpg).size);
      }
      try {
        fs.unlinkSync(jpg);
      } catch (e) {}
    }
  }
  try {
    fs.unlinkSync(tmpMp4);
  } catch (e) {}

  if (!changed && !thumbUrl) {
    return { id: id, skipped: true, reason: 'nothing_to_do', faststart: true };
  }

  var newUrl = url;
  if (changed) {
    if (DRY) {
      console.log('  DRY would upload faststart mp4', outBuf.length);
    } else {
      newUrl = await uploadBytes(outBuf, 'fs_' + id + '_' + Date.now() + '.mp4', 'video/mp4');
      console.log('  uploaded', newUrl);
      // Verify remote Fast Start
      var verify = await fetch(publicMediaUrl(newUrl));
      var vbuf = Buffer.from(await verify.arrayBuffer());
      var vinfo = inspectMp4(vbuf);
      console.log('  verify faststart', !!vinfo.faststart, 'size', vbuf.length);
      if (!vinfo.faststart) throw new Error('uploaded file not faststart');
    }
  }

  var patch = {};
  if (changed) patch.image_url = newUrl;
  if (thumbUrl) {
    patch.tags = withVthumb(tags, thumbUrl);
  }
  if (DRY) {
    console.log('  DRY patch', JSON.stringify(patch).slice(0, 240));
    return { id: id, dry: true, changed: changed, thumb: !!thumbUrl };
  }
  var updated = await sb('/rest/v1/posts?id=eq.' + encodeURIComponent(String(id)), {
    method: 'PATCH',
    body: JSON.stringify(patch)
  });
  console.log('  patched', Array.isArray(updated) ? updated.length : updated);
  return {
    id: id,
    changed: changed,
    thumb: !!thumbUrl,
    oldKey: key,
    newUrl: newUrl,
    size: outBuf.length
  };
}

(async function () {
  var rows;
  if (ONLY.length) {
    rows = await sb(
      '/rest/v1/posts?select=id,image_url,tags,created_at,title&id=in.(' +
        ONLY.join(',') +
        ')'
    );
  } else {
    rows = await sb(
      '/rest/v1/posts?select=id,image_url,tags,created_at,title&image_url=ilike.*.mp4*&order=created_at.desc&limit=' +
        LIMIT
    );
  }
  if (!Array.isArray(rows)) throw new Error('unexpected rows');
  console.log('candidates', rows.length, DRY ? '(dry-run)' : '');
  var results = [];
  for (var r = 0; r < rows.length; r++) {
    try {
      results.push(await repairRow(rows[r]));
    } catch (e) {
      console.error('FAIL', rows[r].id, e.message || e);
      results.push({ id: rows[r].id, error: String(e.message || e) });
    }
  }
  console.log('\nSUMMARY');
  console.log(JSON.stringify(results, null, 2));
})().catch(function (e) {
  console.error(e);
  process.exit(1);
});
