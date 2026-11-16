// Videos / GoonTok catalog.
// Playback files live on Cloudflare R2 (pub-…r2.dev). Worker /media/* often 404s,
// so every URL is rewritten to the public R2 host.
// CF D1 /feed?type=video is empty (POST /posts broken) — the index is Supabase
// posts.image_url pointing at those R2/worker media keys. Never query media_url
// (column does not exist → 400 → UI collapses to ~2 tagged clips).
//
// CRITICAL: Prefer image_url=ilike.*.mp4* — patterns like *http%.mp4% / */media/%.mp4%
// currently 500 on SB edge and starve the catalog down to the ~2 tagged rows.

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://snlpdolzhzcbbdyxqlnb.supabase.co';
const SUPABASE_ANON =
  process.env.SUPABASE_ANON_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNubHBkb2x6aHpjYmJkeXhxbG5iIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY1NTg0OTYsImV4cCI6MjEwMjEzNDQ5Nn0.sWbn1sLgG6vi6wzKxpW5-1Td47awaxhwA-4ixKXZN-E';
const CF_MEDIA = process.env.CF_MEDIA || 'https://pub-b65c88e28c02405ba88db599e7c80d0f.r2.dev';
const CF_API = process.env.CF_API || 'https://ruiningsubs-api.0788adm.workers.dev';
const COLS = 'id,username,title,tags,image_url,created_at,expires_at,views,likes_count';

function json(res, code, body) {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Vary', 'Origin');
  res.end(JSON.stringify(body));
}

function publicMediaUrl(u) {
  u = String(u || '').trim();
  if (!u) return '';
  var m = u.match(/^https?:\/\/ruiningsubs-api\.0788adm\.workers\.dev\/media\/([^?#]+)/i);
  if (m && m[1]) return CF_MEDIA + '/' + decodeURIComponent(m[1]);
  return u;
}

function parseImages(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.filter(Boolean).map(String);
  if (typeof raw !== 'string') return [];
  if (raw.charAt(0) === '[') {
    try {
      var a = JSON.parse(raw);
      return Array.isArray(a) ? a.filter(Boolean).map(String) : [];
    } catch (e) {
      return [];
    }
  }
  return [raw];
}

function isImageUrl(u) {
  var s = String(u || '')
    .split('?')[0]
    .split('#')[0]
    .toLowerCase();
  return /\.(jpe?g|png|gif|webp|avif|bmp|heic|heif)(\/)?$/.test(s);
}

function isVideoUrl(u) {
  u = publicMediaUrl(u);
  var s = String(u || '')
    .split('?')[0]
    .split('#')[0]
    .toLowerCase();
  if (!s || isImageUrl(s)) return false;
  if (/\.(mp4|webm|mov|m4v|m4a|ogg|qt)(\/)?$/.test(s)) return true;
  if (s.indexOf('/object/public/vids/') >= 0 || s.indexOf('/object/public/videos/') >= 0) return true;
  return false;
}

function unpackAlbumTags(tags) {
  var out = [];
  if (!Array.isArray(tags)) return out;
  tags.forEach(function (t) {
    t = String(t || '');
    if (t.indexOf('album:') !== 0) return;
    try {
      var raw = t.slice(6);
      while (raw.length % 4) raw += '=';
      var arr = JSON.parse(Buffer.from(raw, 'base64').toString('utf8'));
      if (Array.isArray(arr)) {
        arr.forEach(function (u) {
          if (u && out.indexOf(u) < 0) out.push(String(u));
        });
      }
    } catch (e) {}
  });
  return out;
}

function normalizeTags(tags) {
  if (!tags) return [];
  if (typeof tags === 'string') {
    try {
      tags = JSON.parse(tags);
    } catch (e) {
      tags = String(tags).split(/[,\s]+/);
    }
  }
  return Array.isArray(tags) ? tags : [];
}

function parseVthumbTag(tags) {
  tags = normalizeTags(tags);
  for (var i = 0; i < tags.length; i++) {
    var t = String(tags[i] || '');
    if (t.indexOf('vthumb:') === 0) {
      var u = t.slice(7).trim();
      if (u) return publicMediaUrl(u);
    }
  }
  return '';
}

function rowToVideo(row) {
  if (!row || row.id == null) return null;
  var tags = normalizeTags(row.tags);
  var imgs = parseImages(row.image_url || '');
  unpackAlbumTags(tags).forEach(function (u) {
    if (u && imgs.indexOf(u) < 0) imgs.push(u);
  });
  imgs = imgs.map(publicMediaUrl).filter(Boolean);
  var vsrc = imgs.filter(isVideoUrl)[0] || '';
  if (!vsrc) return null;
  if (tags.indexOf('video') < 0) tags = tags.concat(['video']);
  if (tags.indexOf('goontok') < 0) tags = tags.concat(['goontok']);
  var poster =
    parseVthumbTag(tags) ||
    imgs.filter(function (u) {
      return u && !isVideoUrl(u);
    })[0] ||
    '';
  return {
    id: row.id,
    username: row.username || row.user || 'anon',
    title: row.title || '',
    tags: tags,
    image_url: vsrc,
    media_url: vsrc,
    thumb_url: publicMediaUrl(poster),
    poster: publicMediaUrl(poster),
    optimized_url: publicMediaUrl(row.optimized_url || ''),
    media_type: 'video',
    created_at: row.created_at || null,
    expires_at: row.expires_at || null,
    views: row.views || 0,
    likes_count: row.likes_count || row.likes || 0,
  };
}

async function sbGet(path, tries) {
  var lastStatus = 0;
  for (var i = 0; i < (tries || 2); i++) {
    try {
      var r = await fetch(SUPABASE_URL + path, {
        headers: {
          apikey: SUPABASE_ANON,
          Authorization: 'Bearer ' + SUPABASE_ANON,
          Accept: 'application/json',
        },
        cache: 'no-store',
      });
      lastStatus = r.status;
      if (r.ok) {
        var j = await r.json();
        return Array.isArray(j) ? j : [];
      }
      if (r.status === 522 || r.status === 520 || r.status === 500 || r.status === 429) {
        await new Promise(function (res) {
          setTimeout(res, 400 * (i + 1));
        });
        continue;
      }
      return [];
    } catch (e) {
      await new Promise(function (res) {
        setTimeout(res, 400 * (i + 1));
      });
    }
  }
  return lastStatus ? [] : [];
}

async function collectFromSb() {
  // Lead with the working extension scans (*.mp4* returns ~78 in <1s).
  // Do NOT lead with *http%.mp4% / */media% — those 500 on SB edge.
  var paths = [
    '/rest/v1/posts?select=' + COLS + '&image_url=ilike.*.mp4*&order=created_at.desc&limit=100',
    '/rest/v1/posts?select=' + COLS + '&image_url=ilike.*.webm*&order=created_at.desc&limit=40',
    '/rest/v1/posts?select=' + COLS + '&image_url=ilike.*.mov*&order=created_at.desc&limit=40',
    '/rest/v1/posts?select=' + COLS + '&tags=cs.%7Bvideo%7D&order=created_at.desc&limit=80',
    '/rest/v1/posts?select=' + COLS + '&tags=cs.%7Bgoontok%7D&order=created_at.desc&limit=80',
  ];
  var seen = {};
  var out = [];
  function ingest(rows) {
    (rows || []).forEach(function (row) {
      var v = rowToVideo(row);
      if (!v || seen[String(v.id)]) return;
      seen[String(v.id)] = 1;
      out.push(v);
    });
  }
  // Primary mp4 scan first (fast + complete)
  ingest(await sbGet(paths[0], 3));
  // Fill extras in parallel
  var extra = await Promise.all(paths.slice(1).map(function (p) {
    return sbGet(p, 2);
  }));
  extra.forEach(ingest);
  out.sort(function (a, b) {
    return new Date(b.created_at || 0) - new Date(a.created_at || 0);
  });
  return out;
}

async function collectFromCf() {
  try {
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var to = ctrl ? setTimeout(function () { try { ctrl.abort(); } catch (e) {} }, 4000) : null;
    var r = await fetch(CF_API + '/feed?limit=200', {
      cache: 'no-store',
      signal: ctrl ? ctrl.signal : undefined,
    });
    if (to) clearTimeout(to);
    if (!r.ok) return [];
    var j = await r.json();
    var posts = (j && j.posts) || [];
    var out = [];
    posts.forEach(function (row) {
      if (!row) return;
      var media = publicMediaUrl(row.media_url || '');
      var thumb = publicMediaUrl(row.thumb_url || '');
      if (!(row.media_type === 'video' || isVideoUrl(media))) return;
      out.push({
        id: row.id,
        username: row.username || 'anon',
        title: row.title || '',
        tags: normalizeTags(row.tags).concat(['video', 'goontok']),
        image_url: media,
        media_url: media,
        thumb_url: thumb && !isVideoUrl(thumb) ? thumb : '',
        optimized_url: '',
        media_type: 'video',
        created_at: row.created_at || null,
        expires_at: row.expires_at || null,
        views: row.views || 0,
        likes_count: row.likes_count || 0,
      });
    });
    return out;
  } catch (e) {
    return [];
  }
}

// —— Same-origin media proxy (folded here to stay ≤12 Hobby serverless functions).
// Route: /api/media?key=… rewritten → /api/videos?key=…
// Playback <video> still uses public R2 directly.
function mediaCors(extra) {
  return Object.assign(
    {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,HEAD,OPTIONS',
      'Access-Control-Allow-Headers': 'Range, Content-Type, Origin, Accept',
      'Access-Control-Expose-Headers':
        'Accept-Ranges, Content-Range, Content-Length, Content-Type, ETag, Last-Modified',
      'Cross-Origin-Resource-Policy': 'cross-origin'
    },
    extra || {}
  );
}

function mediaObjectKey(req) {
  var q = req.query || {};
  var key = q.key || q.k || '';
  if (!key && req.url) {
    try {
      var u = new URL(req.url, 'http://localhost');
      key = u.searchParams.get('key') || u.searchParams.get('k') || '';
    } catch (e) {}
  }
  key = String(key || '').trim();
  if (!key) return '';
  try {
    key = decodeURIComponent(key);
  } catch (e) {}
  if (!key || key.indexOf('..') >= 0 || /^https?:/i.test(key) || key.charAt(0) === '/') return '';
  return key;
}

function guessMediaType(key) {
  var k = String(key || '').toLowerCase();
  if (/\.webm($|\?)/.test(k)) return 'video/webm';
  if (/\.mov($|\?)/.test(k)) return 'video/quicktime';
  if (/\.m4v($|\?)/.test(k)) return 'video/mp4';
  if (/\.mp4($|\?)/.test(k)) return 'video/mp4';
  if (/\.jpe?g($|\?)/.test(k)) return 'image/jpeg';
  if (/\.png($|\?)/.test(k)) return 'image/png';
  if (/\.webp($|\?)/.test(k)) return 'image/webp';
  if (/\.gif($|\?)/.test(k)) return 'image/gif';
  return 'application/octet-stream';
}

function writeMedia(res, code, headers, body) {
  if (typeof res.writeHead === 'function') {
    res.writeHead(code, headers);
    res.end(body);
    return;
  }
  res.statusCode = code;
  Object.keys(headers || {}).forEach(function (k) {
    try {
      res.setHeader(k, headers[k]);
    } catch (e) {}
  });
  res.end(body);
}

async function handleMediaProxy(req, res) {
  if (req.method === 'OPTIONS') {
    writeMedia(res, 204, mediaCors({ 'Access-Control-Max-Age': '86400' }));
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    writeMedia(res, 405, mediaCors({ 'Content-Type': 'application/json', Allow: 'GET, HEAD, OPTIONS' }), JSON.stringify({ error: 'method_not_allowed' }));
    return;
  }
  var key = mediaObjectKey(req);
  if (!key) {
    writeMedia(res, 400, mediaCors({ 'Content-Type': 'application/json' }), JSON.stringify({ error: 'missing_key' }));
    return;
  }
  var upstream = CF_MEDIA + '/' + key.split('/').map(encodeURIComponent).join('/');
  var headers = { 'User-Agent': 'RuinExpose-media-proxy/1.0' };
  var range = (req.headers && (req.headers.range || req.headers.Range)) || '';
  if (range) headers.Range = range;

  var upstreamRes;
  try {
    upstreamRes = await fetch(upstream, { method: 'GET', headers: headers });
  } catch (e) {
    writeMedia(res, 502, mediaCors({ 'Content-Type': 'application/json' }), JSON.stringify({ error: 'upstream_fetch_failed' }));
    return;
  }

  if (req.method === 'HEAD' && !range && upstreamRes.status === 200) {
    try {
      upstreamRes.body && upstreamRes.body.cancel && upstreamRes.body.cancel();
    } catch (e) {}
    try {
      upstreamRes = await fetch(upstream, {
        method: 'GET',
        headers: Object.assign({}, headers, { Range: 'bytes=0-0' })
      });
    } catch (e) {}
  }

  var status = upstreamRes.status;
  if (status !== 200 && status !== 206) {
    writeMedia(res, status || 404, mediaCors({ 'Content-Type': 'application/json' }), JSON.stringify({ error: 'not_found', status: status }));
    return;
  }

  var out = mediaCors({
    'Content-Type': upstreamRes.headers.get('Content-Type') || guessMediaType(key),
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'public, max-age=31536000, immutable'
  });
  var cl = upstreamRes.headers.get('Content-Length');
  var cr = upstreamRes.headers.get('Content-Range');
  var etag = upstreamRes.headers.get('ETag');
  var lm = upstreamRes.headers.get('Last-Modified');
  if (cl) out['Content-Length'] = cl;
  if (cr) out['Content-Range'] = cr;
  if (etag) out.ETag = etag;
  if (lm) out['Last-Modified'] = lm;

  if (req.method === 'HEAD') {
    try {
      upstreamRes.body && upstreamRes.body.cancel && upstreamRes.body.cancel();
    } catch (e) {}
    writeMedia(res, status, out);
    return;
  }

  try {
    var ab = await upstreamRes.arrayBuffer();
    writeMedia(res, status, out, Buffer.from(ab));
  } catch (e) {
    writeMedia(res, status, out);
  }
}

module.exports = async function handler(req, res) {
  // /api/media?key=… (Hobby: rewritten onto this function)
  var isMedia =
    !!(req.query && (req.query.key || req.query.k)) ||
    !!(req.url && /(?:^|[?&])(?:key|k)=/.test(String(req.url)));
  if (isMedia) return handleMediaProxy(req, res);

  if (req.method === 'OPTIONS') return json(res, 204, {});
  if (req.method !== 'GET') return json(res, 405, { error: 'method_not_allowed' });

  try {
    var sbRows = await collectFromSb();
    var cfRows = await collectFromCf();
    var seen = {};
    var posts = [];
    sbRows.concat(cfRows).forEach(function (p) {
      if (!p || p.id == null || seen[String(p.id)]) return;
      seen[String(p.id)] = 1;
      posts.push(p);
    });
    posts.sort(function (a, b) {
      return new Date(b.created_at || 0) - new Date(a.created_at || 0);
    });
    return json(res, 200, {
      posts: posts,
      count: posts.length,
      source: 'cloudflare-r2+supabase-index',
    });
  } catch (e) {
    return json(res, 500, { error: 'videos_failed', message: String(e && e.message ? e.message : e) });
  }
};
