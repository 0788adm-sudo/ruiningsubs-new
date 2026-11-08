#!/usr/bin/env node
/**
 * Repair GoonTok / tagged-video posts that packed thumb_url into image_url
 * (causing video + fake photo in the detail gallery) and/or still carry a timer.
 *
 * SAFETY:
 * - Only touches rows tagged `video` or `goontok`.
 * - Skips rows with profile_gallery / normal_feed / multi-photo album tags
 *   (those keep their album: payloads intact).
 * - Does NOT delete storage files — thumbs remain on R2/CDN as posters.
 */
'use strict';
var KEY =
  process.env.SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNubHBkb2x6aHpjYmJkeXhxbG5iIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY1NTg0OTYsImV4cCI6MjEwMjEzNDQ5Nn0.sWbn1sLgG6vi6wzKxpW5-1Td47awaxhwA-4ixKXZN-E';
var SB = process.env.SUPABASE_URL || 'https://snlpdolzhzcbbdyxqlnb.supabase.co';
var DRY = process.argv.indexOf('--dry') >= 0;

function isVideo(u) {
  return /\.(mp4|webm|mov|m4v)(\?|#|$)/i.test(String(u || ''));
}
function isImage(u) {
  return /\.(jpe?g|png|gif|webp|avif)(\?|#|$)/i.test(String(u || ''));
}
function parseArr(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.filter(Boolean).map(String);
  var s = String(raw).trim();
  if (s.charAt(0) === '[') {
    try {
      var a = JSON.parse(s);
      return Array.isArray(a) ? a.filter(Boolean).map(String) : [];
    } catch (e) {
      return [];
    }
  }
  return s ? [s] : [];
}
function tagsOf(row) {
  var t = row.tags || [];
  if (typeof t === 'string') {
    try {
      t = JSON.parse(t);
    } catch (e) {
      t = String(t).split(/[,\s]+/);
    }
  }
  return (Array.isArray(t) ? t : []).map(function (x) {
    return String(x || '')
      .toLowerCase()
      .replace(/^#/, '');
  });
}

async function sb(path, opts) {
  opts = opts || {};
  var r = await fetch(SB + path, {
    method: opts.method || 'GET',
    headers: Object.assign(
      {
        apikey: KEY,
        Authorization: 'Bearer ' + KEY,
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Prefer: opts.prefer || 'return=representation',
      },
      opts.headers || {}
    ),
    body: opts.body || undefined,
  });
  var text = await r.text();
  var data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch (e) {
    data = text;
  }
  if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + JSON.stringify(data).slice(0, 200));
  return data;
}

(async function () {
  var rows = await sb(
    '/rest/v1/posts?select=id,image_url,tags,expires_at&or=(tags.cs.%7Bvideo%7D,tags.cs.%7Bgoontok%7D)&order=created_at.desc&limit=300'
  );
  if (!Array.isArray(rows)) throw new Error('unexpected rows');
  var fixed = 0,
    skipped = 0;
  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    var tg = tagsOf(row);
    if (tg.indexOf('video') < 0 && tg.indexOf('goontok') < 0) {
      skipped++;
      continue;
    }
    // Never collapse wall/profile albums.
    if (tg.indexOf('profile_gallery') >= 0 || tg.indexOf('normal_feed') >= 0 || tg.indexOf('profile_only') >= 0) {
      skipped++;
      continue;
    }
    var arr = parseArr(row.image_url);
    var vids = arr.filter(isVideo);
    var imgs = arr.filter(isImage);
    if (!vids.length) {
      skipped++;
      continue;
    }
    // Only rewrite when a thumb/photo is packed beside the video, or a timer remains.
    var needMedia = imgs.length > 0 || arr.length !== 1 || !isVideo(arr[0]);
    var needExp = !!row.expires_at;
    if (!needMedia && !needExp) {
      skipped++;
      continue;
    }
    var patch = {};
    if (needMedia) patch.image_url = vids[0];
    if (needExp) patch.expires_at = null;
    console.log((DRY ? 'DRY ' : 'FIX ') + row.id, 'stripImgs', imgs.length, needExp ? 'clearExp' : '');
    if (!DRY) {
      await sb('/rest/v1/posts?id=eq.' + encodeURIComponent(String(row.id)), {
        method: 'PATCH',
        body: JSON.stringify(patch),
      });
    }
    fixed++;
  }
  console.log('\nDone. fixed=' + fixed + ' skipped=' + skipped + (DRY ? ' (dry-run)' : ''));
})().catch(function (e) {
  console.error(e);
  process.exit(1);
});
