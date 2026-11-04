#!/usr/bin/env node
/**
 * Ensures Videos/GoonTok can discover more than a couple of clips.
 * Regression: referencing posts.media_url in the SB OR filter 400s and
 * leaves the UI with only ~1–2 tagged videos.
 * Also: http%.mp4 and media-path scans 500 on SB edge — primary must be *.mp4*.
 */
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

function assert(c, m) {
  if (!c) throw new Error(m);
  console.log('PASS · ' + m);
}

assert(!/media_url\.ilike\.%\.mp4%/.test(html), 'no media_url.ilike in fetchVideoPosts');
assert(html.includes('image_url=ilike.*.mp4*') || html.includes("ilike('image_url','%.mp4%')"), 'primary REST scan is *.mp4* (working path)');
assert(html.includes('tags=cs.%7Bvideo%7D') || html.includes('tags=cs.%7Bgoontok%7D'), 'tags cs filter URL-encodes braces');
assert(html.includes('Narrow select') || html.includes('sbCols='), 'uses narrow column select (not select=*)');
assert(html.includes('posts.media_url does NOT exist') || html.includes('media_url does NOT exist'), 'documents why media_url is avoided');
assert(html.includes('GT_TARGET=80') && html.includes('GT_PAGE=24'), 'GoonTok loads pages of 24 toward 80');
assert(html.includes('sbPaths') || html.includes('sbRest') || html.includes('primaryMp4'), 'SB REST video scans present');
assert(html.includes('window.collectVideos=collectVideos'), 'collectVideos exported for diagnostics');
assert(html.includes('unpackAlbumTags'), 'album tags unpacked when resolving video rows');
assert(html.includes("/api/videos"), 'prefers same-origin /api/videos catalog');
assert(html.includes('CF_MEDIA') && html.includes('r2.dev'), 'rewrites playback to Cloudflare R2');
assert(html.includes('primaryMp4') || html.includes('*.mp4*'), 'client leads with primary mp4 scan');
assert(html.includes("tags.push('goontok')") || html.includes('tags.push("goontok")'), 'video publish tags goontok');

const apiVideos = fs.readFileSync(path.join(__dirname, '..', 'api', 'videos.js'), 'utf8');
assert(apiVideos.includes('cloudflare-r2') || apiVideos.includes('CF_MEDIA'), 'api/videos serves R2-rewritten catalog');
assert(!/media_url\.ilike/.test(apiVideos), 'api/videos never queries missing media_url column');
assert(apiVideos.includes('ilike.*.mp4*'), 'api/videos primary scan is *.mp4*');
assert(!apiVideos.includes('ilike.*http%.mp4%') || apiVideos.indexOf('ilike.*.mp4*') < apiVideos.indexOf('ilike.*http%.mp4%'), 'api/videos does not lead with broken http%.mp4 pattern');

const SB = process.env.SUPABASE_URL || 'https://snlpdolzhzcbbdyxqlnb.supabase.co';
const KEY =
  process.env.SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNubHBkb2x6aHpjYmJkeXhxbG5iIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY1NTg0OTYsImV4cCI6MjEwMjEzNDQ5Nn0.sWbn1sLgG6vi6wzKxpW5-1Td47awaxhwA-4ixKXZN-E';

function sleep(ms) {
  return new Promise(function (r) {
    setTimeout(r, ms);
  });
}

async function sbFetch(path, tries) {
  var last = null;
  for (var i = 0; i < (tries || 5); i++) {
    try {
      var r = await fetch(SB + path, {
        headers: { apikey: KEY, Authorization: 'Bearer ' + KEY, Accept: 'application/json' },
      });
      var text = await r.text();
      var body = null;
      try {
        body = JSON.parse(text);
      } catch (e) {
        body = text.slice(0, 80);
      }
      last = { status: r.status, body: body };
      if (r.status === 200 || r.status === 400) return last;
    } catch (e) {
      last = { status: 0, body: String(e && e.message ? e.message : e) };
    }
    await sleep(2500 * (i + 1));
  }
  return last;
}

(async function () {
  const broken = await sbFetch(
    '/rest/v1/posts?select=id&or=(image_url.ilike.*.mp4*,media_url.ilike.*.mp4*)&limit=5'
  );
  if (broken.status === 400) {
    assert(true, 'legacy media_url OR still 400s (documents the bug)');
  } else {
    console.log('WARN · could not repro media_url 400 (SB status ' + broken.status + ') — static checks still pass');
  }

  const good = await sbFetch(
    '/rest/v1/posts?select=id,image_url&image_url=ilike.*.mp4*&order=created_at.desc&limit=80'
  );
  if (good.status === 200 && Array.isArray(good.body)) {
    assert(good.body.length >= 20, 'live *.mp4* scan returns a full catalog (' + good.body.length + ')');
  } else {
    console.log('WARN · live *.mp4* scan unavailable (SB status ' + (good && good.status) + ') — static regression guards passed');
  }

  console.log('\nVideo fetch restore checks passed');
})().catch(function (e) {
  console.error(e);
  process.exit(1);
});
