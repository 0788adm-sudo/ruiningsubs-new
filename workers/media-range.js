/**
 * Cloudflare Worker patch: GET/HEAD /media/:key with HTTP Range (206).
 *
 * Drop into the Worker router for paths starting with /media/.
 * Preserves CORS * for fetch/canvas. Does NOT replace R2 <video> playback.
 *
 * Required bindings (first match wins):
 *   env.MEDIA — R2 bucket used by the live Worker (delete/upload paths)
 *   env.MEDIA_BUCKET / env.R2 / env.BUCKET — aliases
 *
 * Dashboard paste instructions: workers/MEDIA_RANGE_DASHBOARD_PATCH.md
 * Same-origin fallback on Vercel: /api/media → /api/videos (handleMediaProxy).
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

  const bucket = env.MEDIA || env.MEDIA_BUCKET || env.R2 || env.BUCKET;
  if (!bucket || typeof bucket.get !== 'function') {
    return new Response(JSON.stringify({ error: 'bucket_unbound' }), {
      status: 500,
      headers: { ...cors, 'Content-Type': 'application/json' }
    });
  }

  const rangeHdr = request.headers.get('Range');
  const parsed = rangeHdr ? parseRangeHeader(rangeHdr) : null;

  // Prefer head first when Range is present so we can emit a correct 416
  // without downloading the whole object (legacy Worker path did that).
  let totalSize = null;
  if (parsed && typeof bucket.head === 'function') {
    try {
      const meta = await bucket.head(key);
      if (!meta) {
        return new Response(JSON.stringify({ error: 'not_found' }), {
          status: 404,
          headers: { ...cors, 'Content-Type': 'application/json' }
        });
      }
      if (typeof meta.size === 'number') totalSize = meta.size;
    } catch (e) {}
  }

  if (parsed && totalSize != null && parsed.offset >= totalSize) {
    return new Response(null, {
      status: 416,
      headers: {
        ...cors,
        'Content-Type': 'video/mp4',
        'Accept-Ranges': 'bytes',
        'Content-Range': 'bytes */' + totalSize
      }
    });
  }

  let rangeOpt;
  if (parsed) {
    if (parsed.length != null) rangeOpt = { offset: parsed.offset, length: parsed.length };
    else if (totalSize != null) rangeOpt = { offset: parsed.offset, length: totalSize - parsed.offset };
    else rangeOpt = { offset: parsed.offset };
  }

  const obj = await bucket.get(key, rangeOpt ? { range: rangeOpt } : undefined);
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

  const total = typeof obj.size === 'number' ? obj.size : totalSize;
  let status = 200;

  if (rangeHdr && obj.range) {
    // R2 returns { offset, length } on ranged gets — never stream the full object.
    const start = obj.range.offset || 0;
    const length = obj.range.length != null ? obj.range.length : total != null ? total - start : null;
    if (length != null) headers.set('Content-Length', String(length));
    if (total != null && length != null) {
      headers.set('Content-Range', 'bytes ' + start + '-' + (start + length - 1) + '/' + total);
      status = 206;
    }
  } else if (rangeHdr && !obj.range) {
    // Binding ignored Range — refuse to pretend this is progressive. Callers must
    // fall back to R2 public host for <video>. Still return CORS for diagnostics.
    if (total != null) headers.set('Content-Length', String(total));
  } else if (total != null) {
    headers.set('Content-Length', String(total));
  }

  if (request.method === 'HEAD') {
    return new Response(null, { status, headers });
  }
  return new Response(obj.body, { status, headers });
}

function parseRangeHeader(range) {
  // bytes=start-end (single range only; multipart not used by Safari/video)
  const m = String(range || '').match(/bytes=(\d+)-(\d*)/i);
  if (!m) return null;
  const offset = Number(m[1]);
  if (!Number.isFinite(offset) || offset < 0) return null;
  if (m[2]) {
    const end = Number(m[2]);
    if (!Number.isFinite(end) || end < offset) return null;
    return { offset, length: end - offset + 1, end: end };
  }
  return { offset };
}

function guessType(key) {
  const k = String(key || '').toLowerCase();
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
