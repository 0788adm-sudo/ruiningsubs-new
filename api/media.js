// Same-origin media proxy for CORS fetch/canvas + HTTP Range.
// Playback <video> still uses public R2 directly (Accept-Ranges/206 already works).
// Worker /media currently 404s; this restores the fetchable CORS path without
// changing the dual-host playback architecture.
const CF_MEDIA = 'https://pub-b65c88e28c02405ba88db599e7c80d0f.r2.dev';

function corsHeaders(extra) {
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

function mediaKey(req) {
  var q = req.query || {};
  var key = q.key || q.k || '';
  if (!key && req.url) {
    try {
      var u = new URL(req.url, 'http://localhost');
      key = u.searchParams.get('key') || u.searchParams.get('k') || '';
      if (!key) {
        var m = u.pathname.match(/\/api\/media\/(.+)$/i);
        if (m && m[1]) key = m[1];
      }
    } catch (e) {}
  }
  key = String(key || '').trim();
  if (!key) return '';
  try {
    key = decodeURIComponent(key);
  } catch (e) {}
  // Prevent path escape / host injection
  if (!key || key.indexOf('..') >= 0 || /^https?:/i.test(key) || key.charAt(0) === '/') return '';
  return key;
}

function guessType(key) {
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

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders({ 'Access-Control-Max-Age': '86400' }));
    res.end();
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, corsHeaders({ Allow: 'GET, HEAD, OPTIONS' }));
    res.end(JSON.stringify({ error: 'method_not_allowed' }));
    return;
  }

  var key = mediaKey(req);
  if (!key) {
    res.writeHead(400, corsHeaders({ 'Content-Type': 'application/json' }));
    res.end(JSON.stringify({ error: 'missing_key' }));
    return;
  }

  var upstream = CF_MEDIA + '/' + key.split('/').map(encodeURIComponent).join('/');
  var headers = { 'User-Agent': 'RuinExpose-media-proxy/1.0' };
  var range = req.headers.range || req.headers.Range;
  if (range) headers.Range = range;

  var upstreamRes;
  try {
    upstreamRes = await fetch(upstream, {
      method: req.method === 'HEAD' ? 'GET' : 'GET',
      headers: headers
    });
  } catch (e) {
    res.writeHead(502, corsHeaders({ 'Content-Type': 'application/json' }));
    res.end(JSON.stringify({ error: 'upstream_fetch_failed' }));
    return;
  }

  if (req.method === 'HEAD') {
    // Prefer a cheap existence probe via Range when caller did not send one.
    if (!range && upstreamRes.status === 200) {
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
  }

  var status = upstreamRes.status;
  if (status !== 200 && status !== 206) {
    res.writeHead(status || 404, corsHeaders({ 'Content-Type': 'application/json' }));
    res.end(JSON.stringify({ error: 'not_found', status: status }));
    return;
  }

  var out = {
    'Content-Type': upstreamRes.headers.get('Content-Type') || guessType(key),
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'public, max-age=31536000, immutable'
  };
  var cl = upstreamRes.headers.get('Content-Length');
  var cr = upstreamRes.headers.get('Content-Range');
  var etag = upstreamRes.headers.get('ETag');
  var lm = upstreamRes.headers.get('Last-Modified');
  if (cl) out['Content-Length'] = cl;
  if (cr) out['Content-Range'] = cr;
  if (etag) out.ETag = etag;
  if (lm) out['Last-Modified'] = lm;
  if (status === 206 && !out['Content-Range'] && range) {
    // Should not happen on R2; keep status honest.
  }

  if (req.method === 'HEAD') {
    try {
      upstreamRes.body && upstreamRes.body.cancel && upstreamRes.body.cancel();
    } catch (e) {}
    res.writeHead(status, corsHeaders(out));
    res.end();
    return;
  }

  res.writeHead(status, corsHeaders(out));
  try {
    var ab = await upstreamRes.arrayBuffer();
    res.end(Buffer.from(ab));
  } catch (e) {
    res.end();
  }
};
