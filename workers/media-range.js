/**
 * Cloudflare Worker patch: GET/HEAD /media/:key with HTTP Range (206).
 *
 * Drop into the Worker router for paths starting with /media/.
 * Preserves CORS * for fetch/canvas. Does NOT replace R2 <video> playback.
 *
 * Required bindings:
 *   env.MEDIA_BUCKET — R2 bucket binding (same objects as pub-…r2.dev)
 *
 * Equivalent behavior to api/media.js (Vercel) when Worker /media is restored.
 */
export async function handleMediaRequest(request, env, key) {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,HEAD,OPTIONS',
    'Access-Control-Allow-Headers': 'Range, Content-Type, Origin, Accept',
    'Access-Control-Expose-Headers':
      'Accept-Ranges, Content-Range, Content-Length, Content-Type, ETag, Last-Modified',
    'Cross-Origin-Resource-Policy': 'cross-origin'
  };

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: { ...cors, 'Access-Control-Max-Age': '86400' } });
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response(JSON.stringify({ error: 'method_not_allowed' }), {
      status: 405,
      headers: { ...cors, 'Content-Type': 'application/json', Allow: 'GET, HEAD, OPTIONS' }
    });
  }

  key = String(key || '')
    .replace(/^\/+/, '')
    .trim();
  try {
    key = decodeURIComponent(key);
  } catch (e) {}
  if (!key || key.includes('..') || /^https?:/i.test(key)) {
    return new Response(JSON.stringify({ error: 'bad_key' }), {
      status: 400,
      headers: { ...cors, 'Content-Type': 'application/json' }
    });
  }

  const bucket = env.MEDIA_BUCKET || env.R2 || env.BUCKET;
  if (!bucket || typeof bucket.get !== 'function') {
    return new Response(JSON.stringify({ error: 'bucket_unbound' }), {
      status: 500,
      headers: { ...cors, 'Content-Type': 'application/json' }
    });
  }

  const range = request.headers.get('Range');
  const obj = await bucket.get(key, range ? { range: parseRangeHeader(range) } : undefined);
  if (!obj) {
    return new Response(JSON.stringify({ error: 'not_found' }), {
      status: 404,
      headers: { ...cors, 'Content-Type': 'application/json' }
    });
  }

  const headers = new Headers(cors);
  headers.set('Accept-Ranges', 'bytes');
  headers.set('Cache-Control', 'public, max-age=31536000, immutable');
  const ctype = obj.httpMetadata && obj.httpMetadata.contentType;
  headers.set('Content-Type', ctype || guessType(key));
  if (obj.httpEtag) headers.set('ETag', obj.httpEtag);
  if (obj.uploaded) headers.set('Last-Modified', obj.uploaded.toUTCString());

  const total = typeof obj.size === 'number' ? obj.size : null;
  let status = 200;

  if (range && obj.range) {
    // R2 returns { offset, length } on ranged gets
    const start = obj.range.offset || 0;
    const length = obj.range.length != null ? obj.range.length : total != null ? total - start : null;
    if (length != null) headers.set('Content-Length', String(length));
    if (total != null && length != null) {
      headers.set('Content-Range', 'bytes ' + start + '-' + (start + length - 1) + '/' + total);
      status = 206;
    }
  } else if (total != null) {
    headers.set('Content-Length', String(total));
  }

  if (request.method === 'HEAD') {
    return new Response(null, { status, headers });
  }
  return new Response(obj.body, { status, headers });
}

function parseRangeHeader(range) {
  // bytes=start-end
  const m = String(range || '').match(/bytes=(\d+)-(\d*)/i);
  if (!m) return undefined;
  const offset = Number(m[1]);
  if (m[2]) {
    const end = Number(m[2]);
    return { offset, length: end - offset + 1 };
  }
  return { offset };
}

function guessType(key) {
  const k = String(key || '').toLowerCase();
  if (/\.webm($|\?)/.test(k)) return 'video/webm';
  if (/\.mov($|\?)/.test(k)) return 'video/quicktime';
  if (/\.mp4($|\?)/.test(k)) return 'video/mp4';
  if (/\.jpe?g($|\?)/.test(k)) return 'image/jpeg';
  if (/\.png($|\?)/.test(k)) return 'image/png';
  return 'application/octet-stream';
}
