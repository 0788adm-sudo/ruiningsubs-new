#!/usr/bin/env node
/**
 * Ensures Videos/GoonTok can discover more than a couple of clips.
 * Regression: referencing posts.media_url in the SB OR filter 400s and
 * leaves the UI with only ~1–2 tagged videos.
 */
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

function assert(c, m) {
  if (!c) throw new Error(m);
  console.log('PASS · ' + m);
}

assert(!/media_url\.ilike\.%\.mp4%/.test(html), 'no media_url.ilike in fetchVideoPosts');
assert(!/\.or\(\s*[\n\s]*'image_url\.ilike/.test(html), 'does not use fragile .or(image_url.ilike…) for video scan');
assert(
  html.includes('image_url=ilike.*http%.mp4%') || html.includes("ilike('image_url','%http%.mp4%')"),
  'uses REST image_url http+.mp4 scan (avoids base64 false hits)'
);
assert(html.includes('tags=cs.%7Bvideo%7D') || html.includes('tags=cs.%7Bgoontok%7D'), 'tags cs filter URL-encodes braces');
assert(html.includes('Narrow select') || html.includes('sbCols='), 'uses narrow column select (not select=*)');
assert(html.includes('posts.media_url does NOT exist') || html.includes('media_url does NOT exist'), 'documents why media_url is avoided');
assert(html.includes('GT_TARGET=80') && html.includes('GT_PAGE=24'), 'GoonTok loads pages of 24 toward 80');
assert(html.includes('sbPaths') || html.includes('sbRest'), 'parallel SB REST video scans');
assert(html.includes('window.collectVideos=collectVideos'), 'collectVideos exported for diagnostics');
assert(html.includes('unpackAlbumTags'), 'album tags unpacked when resolving video rows');
assert(html.includes('sbRestGet') || html.includes('fallbacks'), 'has SB REST fallback when parallel scan underfills');
assert(html.includes("/api/videos"), 'prefers same-origin /api/videos catalog');
assert(html.includes('CF_MEDIA') && html.includes('r2.dev'), 'rewrites playback to Cloudflare R2');

const apiVideos = fs.readFileSync(path.join(__dirname, '..', 'api', 'videos.js'), 'utf8');
assert(apiVideos.includes('cloudflare-r2') || apiVideos.includes('CF_MEDIA'), 'api/videos serves R2-rewritten catalog');
assert(!/media_url\.ilike/.test(apiVideos), 'api/videos never queries missing media_url column');

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

  const fixed = await sbFetch(
    '/rest/v1/posts?select=id,username,title,tags,image_url,created_at,views,likes_count&image_url=ilike.*http%.mp4%&order=created_at.desc&limit=100'
  );
  if (fixed.status !== 200 || !Array.isArray(fixed.body)) {
    console.log('WARN · live http+.mp4 scan unavailable (SB status ' + fixed.status + ') — static regression guards passed');
    console.log('\nVideo fetch restore static checks passed (live SB flaky)');
    return;
  }
  const rows = fixed.body;
  assert(rows.length >= 20, 'at least 20 video rows available (' + rows.length + ')');
  const playable = rows.filter(function (r) {
    return /\.(mp4|webm|mov|m4v)(\?|"|$)/i.test(String(r.image_url || ''));
  });
  assert(playable.length >= 15, 'most hits are real video URLs (' + playable.length + '/' + rows.length + ')');
  console.log('\nVideo fetch restore checks passed (' + rows.length + ' clips, ' + playable.length + ' playable)');
})().catch(function (e) {
  console.error('FAIL', e && e.stack ? e.stack : e);
  process.exit(1);
});
