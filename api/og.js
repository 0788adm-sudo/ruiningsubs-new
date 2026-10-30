// Dynamic Open Graph HTML for shared posts (?p=ID).
// Telegram/Facebook/etc. do not run the SPA JS — they need server HTML meta tags.
// Uses the public Supabase anon key (already in the client) + CF Worker fallback.

const SITE = 'https://www.ruiningsubs.com';
const SITE_NAME = 'Ruining Subs';
const DEFAULT_IMAGE = SITE + '/apple-touch-icon.png';
const CF_API = 'https://ruiningsubs-api.0788adm.workers.dev';
const CF_MEDIA = 'https://pub-b65c88e28c02405ba88db599e7c80d0f.r2.dev';
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://snlpdolzhzcbbdyxqlnb.supabase.co';
// Same public anon key shipped in index.html (RLS-scoped). Override via env in Vercel if rotated.
const SUPABASE_ANON =
  process.env.SUPABASE_ANON_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNubHBkb2x6aHpjYmJkeXhxbG5iIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY1NTg0OTYsImV4cCI6MjEwMjEzNDQ5Nn0.sWbn1sLgG6vi6wzKxpW5-1Td47awaxhwA-4ixKXZN-E';

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Worker /media/ paths 404 for crawlers; public R2 host serves the same object keys.
function publicMediaUrl(u) {
  u = String(u || '').trim();
  if (!u) return '';
  var m = u.match(/^https?:\/\/ruiningsubs-api\.0788adm\.workers\.dev\/media\/([^?#]+)/i);
  if (m && m[1]) return CF_MEDIA + '/' + m[1];
  return u;
}

function firstHttpUrl(v) {
  if (!v) return '';
  if (Array.isArray(v)) {
    for (var i = 0; i < v.length; i++) {
      var u = firstHttpUrl(v[i]);
      if (u) return u;
    }
    return '';
  }
  var s = String(v).trim();
  if (/^https?:\/\//i.test(s)) return publicMediaUrl(s.split(/\s|,/)[0]);
  if (s.charAt(0) === '[') {
    try {
      return firstHttpUrl(JSON.parse(s));
    } catch (e) {}
  }
  if (s.charAt(0) === '{') {
    try {
      var o = JSON.parse(s);
      return firstHttpUrl(o.url || o.src || o.thumb_url || o.image || o.media_url || '');
    } catch (e) {}
  }
  return '';
}

function albumUrls(tags) {
  var out = [];
  (tags || []).forEach(function (t) {
    var s = String(t || '');
    if (s.indexOf('album:') !== 0) return;
    try {
      var raw = s.slice(6);
      var pad = raw + '==='.slice((raw.length + 3) % 4);
      var decoded = Buffer.from(pad, 'base64').toString('utf8');
      var arr = JSON.parse(decoded);
      if (Array.isArray(arr)) out = out.concat(arr);
    } catch (e) {}
  });
  return out;
}

function pickImage(row) {
  if (!row) return DEFAULT_IMAGE;
  var candidates = []
    .concat(albumUrls(row.tags))
    .concat([
      row.thumb_url,
      row.poster,
      row.image_url,
      row.media_url,
      row.optimized_url
    ]);
  for (var i = 0; i < candidates.length; i++) {
    var u = firstHttpUrl(candidates[i]);
    if (u && !/^data:/i.test(u) && /\.(jpe?g|png|webp|gif)(\?|$)/i.test(u)) return u;
  }
  for (var j = 0; j < candidates.length; j++) {
    var u2 = firstHttpUrl(candidates[j]);
    if (u2 && !/^data:/i.test(u2)) return u2;
  }
  return DEFAULT_IMAGE;
}

function clip(s, n) {
  s = String(s || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (s.length <= n) return s;
  return s.slice(0, n - 1).trim() + '…';
}

async function fetchJson(url, headers) {
  var r = await fetch(url, { headers: headers || {}, cache: 'no-store' });
  if (!r.ok) return null;
  try {
    return await r.json();
  } catch (e) {
    return null;
  }
}

async function loadPost(id) {
  id = String(id || '').trim();
  if (!id) return null;

  // 1) Supabase numeric / uuid id (primary for ?p=2136 style links)
  try {
    var sbUrl =
      SUPABASE_URL +
      '/rest/v1/posts?id=eq.' +
      encodeURIComponent(id) +
      '&select=id,username,title,description,tags,image_url,created_at,expires_at&limit=1';
    var rows = await fetchJson(sbUrl, {
      apikey: SUPABASE_ANON,
      Authorization: 'Bearer ' + SUPABASE_ANON,
      Accept: 'application/json'
    });
    if (rows && rows[0] && rows[0].id != null) return rows[0];
  } catch (e) {}

  // 2) Cloudflare Worker post / feed lookup
  try {
    var cf =
      (await fetchJson(CF_API + '/posts/' + encodeURIComponent(id), {
        Accept: 'application/json',
        Origin: SITE,
        'User-Agent': 'Mozilla/5.0 RuiningSubsOG/1.0'
      })) ||
      (await fetchJson(CF_API + '/feed?id=' + encodeURIComponent(id) + '&limit=1', {
        Accept: 'application/json',
        Origin: SITE,
        'User-Agent': 'Mozilla/5.0 RuiningSubsOG/1.0'
      }));
    if (cf) {
      var row = cf.post || (cf.posts && cf.posts[0]) || (cf.id ? cf : null);
      if (row && row.id != null) return row;
    }
  } catch (e) {}

  return null;
}

function htmlPage(opts) {
  var title = opts.title;
  var desc = opts.desc;
  var image = opts.image;
  var url = opts.url;
  var user = opts.user;
  var spa = opts.spa;
  // No meta-refresh: crawlers that follow it would land on the SPA and lose OG tags.
  // Humans who hit /api/og get a plain link + JS redirect.
  return (
    '<!DOCTYPE html><html lang="en"><head>' +
    '<meta charset="UTF-8"/>' +
    '<meta name="viewport" content="width=device-width, initial-scale=1"/>' +
    '<title>' +
    esc(title) +
    '</title>' +
    '<meta name="description" content="' +
    esc(desc) +
    '"/>' +
    '<link rel="canonical" href="' +
    esc(url) +
    '"/>' +
    '<meta property="og:site_name" content="' +
    esc(SITE_NAME) +
    '"/>' +
    '<meta property="og:type" content="article"/>' +
    '<meta property="og:title" content="' +
    esc(title) +
    '"/>' +
    '<meta property="og:description" content="' +
    esc(desc) +
    '"/>' +
    '<meta property="og:url" content="' +
    esc(url) +
    '"/>' +
    '<meta property="og:image" content="' +
    esc(image) +
    '"/>' +
    '<meta property="og:image:secure_url" content="' +
    esc(image) +
    '"/>' +
    '<meta property="og:image:type" content="image/jpeg"/>' +
    '<meta property="og:image:width" content="1200"/>' +
    '<meta property="og:image:height" content="630"/>' +
    '<meta name="twitter:card" content="summary_large_image"/>' +
    '<meta name="twitter:title" content="' +
    esc(title) +
    '"/>' +
    '<meta name="twitter:description" content="' +
    esc(desc) +
    '"/>' +
    '<meta name="twitter:image" content="' +
    esc(image) +
    '"/>' +
    (user
      ? '<meta property="article:author" content="' + esc('@' + user) + '"/>'
      : '') +
    '</head><body style="background:#050506;color:#ececef;font-family:system-ui,sans-serif;padding:24px">' +
    '<p>Opening post…</p>' +
    '<p><a href="' +
    esc(spa) +
    '" style="color:#ff6a00">Continue to ' +
    esc(SITE_NAME) +
    '</a></p>' +
    '<script>location.replace(' +
    JSON.stringify(spa) +
    ')</script>' +
    '</body></html>'
  );
}

function isBot(ua) {
  return /TelegramBot|facebookexternalhit|Facebot|Twitterbot|LinkedInBot|Slackbot|Discordbot|WhatsApp|SkypeUriPreview|vkShare|Pinterest|redditbot|Applebot|Googlebot|bingbot|Slurp|DuckDuckBot|Baiduspider|YandexBot|Embedly|Quora Link Preview|Showyoubot|outbrain|Viber|Snapchat|Iframely|BitlyBot/i.test(
    String(ua || '')
  );
}

module.exports = async function handler(req, res) {
  try {
    var q = req.query || {};
    var id = String(q.p || q.post || q.id || '').trim();
    if (!id) {
      res.statusCode = 400;
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.end('Missing post id');
      return;
    }

    // Humans hitting the rewrite land here — send them to the SPA without looping
    // back through the "/?p=" rewrite (index.html?p= is not rewritten).
    var ua = (req.headers && (req.headers['user-agent'] || req.headers['User-Agent'])) || '';
    if (!isBot(ua)) {
      res.statusCode = 302;
      res.setHeader('Location', '/index.html?p=' + encodeURIComponent(id));
      res.setHeader('Cache-Control', 'private, no-store');
      res.end();
      return;
    }

    var post = await loadPost(id);
    var spa = SITE + '/index.html?p=' + encodeURIComponent(id);
    var url = SITE + '/?p=' + encodeURIComponent(id);

    var user = post ? String(post.username || post.user || '').replace(/^@/, '') : '';
    var rawTitle = post ? String(post.title || '').trim() : '';
    var rawDesc = post ? String(post.description || post.desc || '').trim() : '';
    var title = post
      ? clip((user ? user + ': ' : '') + (rawTitle || 'Exposure post'), 90)
      : SITE_NAME + ' — post';
    var desc = post
      ? clip(rawDesc || rawTitle || 'Open this exposure on ruiningsubs.com', 180)
      : 'Public exposure board at ruiningsubs.com';
    var image = post ? pickImage(post) : DEFAULT_IMAGE;

    var body = htmlPage({ title: title, desc: desc, image: image, url: url, user: user, spa: spa });
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');
    res.setHeader('Vary', 'User-Agent');
    res.end(body);
  } catch (e) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end('OG preview error');
  }
};
