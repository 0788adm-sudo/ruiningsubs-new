// Dynamic sitemap of public, indexable posts only.
// Does not mutate the database. Excludes expired and explicitly blocked posts.

const SITE = process.env.SITE_URL || 'https://www.ruinexpose.com';
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://snlpdolzhzcbbdyxqlnb.supabase.co';
const SUPABASE_ANON =
  process.env.SUPABASE_ANON_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNubHBkb2x6aHpjYmJkeXhxbG5iIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY1NTg0OTYsImV4cCI6MjEwMjEzNDQ5Nn0.sWbn1sLgG6vi6wzKxpW5-1Td47awaxhwA-4ixKXZN-E';

const MAX_URLS = 4500;
const BLOCK_TAGS = {
  noindex: 1,
  seo_exclude: 1,
  private: 1,
  removed: 1,
  deleted: 1,
  takedown: 1,
  dmca: 1,
  reported: 1,
  nonconsent: 1,
  'non-consent': 1,
  non_consensual: 1
};

function xmlEsc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function normalizeTags(tags) {
  var arr = tags;
  if (typeof arr === 'string') {
    try {
      arr = JSON.parse(arr);
    } catch (e) {
      arr = String(arr)
        .split(/[,\s]+/)
        .filter(Boolean);
    }
  }
  if (!Array.isArray(arr)) return [];
  return arr.map(function (t) {
    return String(t || '')
      .toLowerCase()
      .replace(/^#/, '')
      .trim();
  });
}

function isIndexableRow(row) {
  if (!row || row.id == null) return false;
  if (row.expires_at) {
    var exp = new Date(row.expires_at).getTime();
    if (exp && isFinite(exp) && exp < Date.now()) return false;
  }
  var tags = normalizeTags(row.tags);
  for (var i = 0; i < tags.length; i++) {
    if (BLOCK_TAGS[tags[i]]) return false;
  }
  return true;
}

async function fetchJson(url) {
  var r = await fetch(url, {
    headers: {
      apikey: SUPABASE_ANON,
      Authorization: 'Bearer ' + SUPABASE_ANON,
      Accept: 'application/json'
    },
    cache: 'no-store'
  });
  if (!r.ok) return [];
  try {
    var j = await r.json();
    return Array.isArray(j) ? j : [];
  } catch (e) {
    return [];
  }
}

async function loadIndexablePosts() {
  var now = new Date().toISOString();
  var select = 'id,created_at,expires_at,tags';
  // Active timed posts + permanent (null expires). Two queries keep the filter simple under RLS.
  var liveUrl =
    SUPABASE_URL +
    '/rest/v1/posts?select=' +
    encodeURIComponent(select) +
    '&expires_at=gt.' +
    encodeURIComponent(now) +
    '&order=created_at.desc&limit=' +
    Math.min(MAX_URLS, 3000);
  var permUrl =
    SUPABASE_URL +
    '/rest/v1/posts?select=' +
    encodeURIComponent(select) +
    '&expires_at=is.null&order=created_at.desc&limit=' +
    Math.min(MAX_URLS, 3000);

  var pairs = await Promise.all([fetchJson(liveUrl), fetchJson(permUrl)]);
  var seen = Object.create(null);
  var out = [];
  function pushAll(rows) {
    (rows || []).forEach(function (row) {
      if (!isIndexableRow(row)) return;
      var id = String(row.id);
      if (seen[id]) return;
      seen[id] = 1;
      out.push(row);
    });
  }
  pushAll(pairs[0]);
  pushAll(pairs[1]);
  out.sort(function (a, b) {
    return new Date(b.created_at || 0) - new Date(a.created_at || 0);
  });
  return out.slice(0, MAX_URLS);
}

function urlEntry(loc, lastmod, changefreq, priority) {
  var parts = ['<url>', '<loc>' + xmlEsc(loc) + '</loc>'];
  if (lastmod) parts.push('<lastmod>' + xmlEsc(lastmod) + '</lastmod>');
  if (changefreq) parts.push('<changefreq>' + xmlEsc(changefreq) + '</changefreq>');
  if (priority) parts.push('<priority>' + xmlEsc(priority) + '</priority>');
  parts.push('</url>');
  return parts.join('');
}

module.exports = async function handler(req, res) {
  try {
    var posts = await loadIndexablePosts();
    var today = new Date().toISOString().slice(0, 10);
    var body = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
    ];

    body.push(urlEntry(SITE + '/', today, 'hourly', '1.0'));
    body.push(urlEntry(SITE + '/extend', today, 'hourly', '0.9'));
    body.push(urlEntry(SITE + '/wall', today, 'hourly', '0.8'));
    body.push(urlEntry(SITE + '/spotlight', today, 'hourly', '0.8'));
    body.push(urlEntry(SITE + '/explore', today, 'daily', '0.7'));
    body.push(urlEntry(SITE + '/goontok', today, 'hourly', '0.7'));
    body.push(urlEntry(SITE + '/videos', today, 'daily', '0.6'));

    posts.forEach(function (row) {
      var id = encodeURIComponent(String(row.id));
      var lm = row.created_at ? new Date(row.created_at).toISOString() : today;
      body.push(urlEntry(SITE + '/post/' + id, lm, 'daily', '0.6'));
    });

    body.push('</urlset>');
    var xml = body.join('');
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Cache-Control', 'public, s-maxage=600, stale-while-revalidate=3600');
    res.end(xml);
  } catch (e) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end('sitemap error');
  }
};
