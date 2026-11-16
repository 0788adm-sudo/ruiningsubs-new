// Dynamic sitemap of public, indexable posts only.
// Does not mutate the database. Excludes expired and explicitly blocked posts.
// Emits well-formed XML (one <url> block per location) for Google Search Console.

const CANONICAL_HOST = 'ruinexpose.com';
const CANONICAL_ORIGIN = 'https://' + CANONICAL_HOST;

function resolveSiteOrigin() {
  var raw = String(process.env.SITE_URL || CANONICAL_ORIGIN).trim().replace(/\/+$/, '');
  try {
    var u = new URL(raw.indexOf('://') >= 0 ? raw : 'https://' + raw);
    var host = String(u.hostname || '')
      .toLowerCase()
      .replace(/^www\./, '');
    if (host === CANONICAL_HOST || host.endsWith('.' + CANONICAL_HOST)) {
      return 'https://' + CANONICAL_HOST;
    }
    if (u.protocol === 'http:' || u.protocol === 'https:') {
      return u.protocol + '//' + host;
    }
  } catch (e) {}
  return CANONICAL_ORIGIN;
}

const SITE = resolveSiteOrigin();
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://snlpdolzhzcbbdyxqlnb.supabase.co';
const SUPABASE_ANON =
  process.env.SUPABASE_ANON_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNubHBkb2x6aHpjYmJkeXhxbG5iIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY1NTg0OTYsImV4cCI6MjEwMjEzNDQ5Nn0.sWbn1sLgG6vi6wzKxpW5-1Td47awaxhwA-4ixKXZN-E';
const CF_MEDIA = 'https://pub-b65c88e28c02405ba88db599e7c80d0f.r2.dev';

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

const STATIC_PAGES = [
  { path: '/', changefreq: 'hourly', priority: '1.0' },
  { path: '/extend', changefreq: 'hourly', priority: '0.9' },
  { path: '/wall', changefreq: 'hourly', priority: '0.8' },
  { path: '/spotlight', changefreq: 'hourly', priority: '0.8' },
  { path: '/explore', changefreq: 'daily', priority: '0.7' },
  { path: '/goontok', changefreq: 'hourly', priority: '0.7' },
  { path: '/videos', changefreq: 'daily', priority: '0.6' }
];

function xmlEsc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
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

function toLastmod(value, fallbackDay) {
  if (!value) return fallbackDay || '';
  var d = new Date(value);
  if (!isFinite(d.getTime())) return fallbackDay || '';
  return d.toISOString().slice(0, 10);
}

/** Worker /media/ → public R2 host (same object keys). Never invents URLs. */
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

function vthumbFromTags(tags) {
  var original = Array.isArray(tags) ? tags : [];
  for (var j = 0; j < original.length; j++) {
    var s = String(original[j] || '');
    if (s.toLowerCase().indexOf('vthumb:') === 0) {
      return firstHttpUrl(s.slice(s.indexOf(':') + 1));
    }
  }
  return '';
}

/** Public still image only — skip videos and empty values; do not invent paths. */
function pickIndexableImage(row) {
  if (!row) return '';
  var candidates = []
    .concat(albumUrls(row.tags))
    .concat([vthumbFromTags(row.tags), row.thumb_url, row.poster, row.image_url, row.media_url]);
  for (var i = 0; i < candidates.length; i++) {
    var u = firstHttpUrl(candidates[i]);
    if (!u || /^data:/i.test(u)) continue;
    if (/\.(mp4|webm|mov|m4v)(\?|$)/i.test(u)) continue;
    if (/\.(jpe?g|png|webp|gif)(\?|$)/i.test(u)) return u;
  }
  return '';
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
  var select = 'id,created_at,expires_at,tags,image_url';
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

/**
 * Build one independent <url> element. Lines are joined with newlines so
 * locations never run together if a consumer strips tags.
 */
function urlEntry(opts) {
  var loc = opts && opts.loc;
  if (!loc) return '';
  var lines = ['  <url>', '    <loc>' + xmlEsc(loc) + '</loc>'];
  if (opts.lastmod) lines.push('    <lastmod>' + xmlEsc(opts.lastmod) + '</lastmod>');
  if (opts.changefreq) lines.push('    <changefreq>' + xmlEsc(opts.changefreq) + '</changefreq>');
  if (opts.priority) lines.push('    <priority>' + xmlEsc(opts.priority) + '</priority>');
  var images = Array.isArray(opts.images) ? opts.images : opts.image ? [opts.image] : [];
  images.forEach(function (img) {
    var href = firstHttpUrl(img);
    if (!href) return;
    lines.push('    <image:image>');
    lines.push('      <image:loc>' + xmlEsc(href) + '</image:loc>');
    lines.push('    </image:image>');
  });
  lines.push('  </url>');
  return lines.join('\n');
}

function buildSitemapXml(posts, today) {
  var day = today || new Date().toISOString().slice(0, 10);
  var entries = [];
  var hasImages = false;

  STATIC_PAGES.forEach(function (page) {
    entries.push(
      urlEntry({
        loc: SITE + page.path,
        lastmod: day,
        changefreq: page.changefreq,
        priority: page.priority
      })
    );
  });

  (posts || []).forEach(function (row) {
    if (!isIndexableRow(row)) return;
    var id = encodeURIComponent(String(row.id));
    var image = pickIndexableImage(row);
    if (image) hasImages = true;
    entries.push(
      urlEntry({
        loc: SITE + '/post/' + id,
        lastmod: toLastmod(row.created_at, day),
        changefreq: 'daily',
        priority: '0.6',
        image: image || undefined
      })
    );
  });

  var ns =
    'xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"' +
    (hasImages ? ' xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"' : '');

  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset ' +
    ns +
    '>\n' +
    entries.filter(Boolean).join('\n') +
    '\n</urlset>\n'
  );
}

async function handler(req, res) {
  try {
    var posts = await loadIndexablePosts();
    var today = new Date().toISOString().slice(0, 10);
    var xml = buildSitemapXml(posts, today);
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    // Shorter CDN TTL so deleted posts drop from sitemap quickly after purge.
    res.setHeader('Cache-Control', 'public, s-maxage=120, stale-while-revalidate=600');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.end(xml);
  } catch (e) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end('sitemap error');
  }
}

handler.buildSitemapXml = buildSitemapXml;
handler.urlEntry = urlEntry;
handler.isIndexableRow = isIndexableRow;
handler.pickIndexableImage = pickIndexableImage;
handler.resolveSiteOrigin = resolveSiteOrigin;
handler.SITE = SITE;
handler.xmlEsc = xmlEsc;

module.exports = handler;
