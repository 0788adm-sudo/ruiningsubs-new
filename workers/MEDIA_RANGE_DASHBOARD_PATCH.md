# Worker dashboard patch — `/media` HTTP Range

**Status (2026-11-16):** Live Worker still ignores `Range` (GET → full HTTP 200 body; HEAD → 404).
`<video>` playback uses public R2 (already 206-correct). Deploy this patch so Worker
`fetch()`/canvas paths stop downloading entire MP4s when only a few bytes are needed.

Canonical implementation: `workers/media-range.js` (`handleMediaRequest`).

Paste the Range handler into the Cloudflare Worker **before** the final:

```js
return json({ error: 'not found' }, 404);
```

Uses the same binding as your delete handler: `env.MEDIA`.

Keeps CORS `*` for fetch/canvas. Does **not** change R2 `<video>` playback.

Minimal paste (prefer copying from `workers/media-range.js` for 416 + HEAD):

```js
      // —— GET/HEAD /media/:key with HTTP Range (Safari progressive MP4) ——
      if (path.startsWith('/media/') && (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS')) {
        const cors = {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET,HEAD,OPTIONS',
          'Access-Control-Allow-Headers': 'Range, Content-Type, Origin, Accept',
          'Access-Control-Expose-Headers':
            'Accept-Ranges, Content-Range, Content-Length, Content-Type, ETag, Last-Modified',
          'Cross-Origin-Resource-Policy': 'cross-origin',
        };
        if (req.method === 'OPTIONS') {
          return new Response(null, {
            status: 204,
            headers: { ...cors, 'Access-Control-Max-Age': '86400' },
          });
        }
        let key = decodeURIComponent(path.slice('/media/'.length)).replace(/^\/+/, '').trim();
        if (!key || key.includes('..') || /^https?:/i.test(key)) {
          return json({ error: 'bad_key' }, 400, cors);
        }
        if (!env.MEDIA || typeof env.MEDIA.get !== 'function') {
          return json({ error: 'bucket_unbound' }, 500, cors);
        }
        const rangeHdr = req.headers.get('Range');
        let rangeOpt;
        let totalHint = null;
        if (rangeHdr) {
          const m = String(rangeHdr).match(/bytes=(\d+)-(\d*)/i);
          if (m) {
            const offset = Number(m[1]);
            rangeOpt = m[2] ? { offset, length: Number(m[2]) - offset + 1 } : { offset };
          }
          if (typeof env.MEDIA.head === 'function') {
            const meta = await env.MEDIA.head(key);
            if (!meta) return json({ error: 'not_found' }, 404, cors);
            totalHint = typeof meta.size === 'number' ? meta.size : null;
            if (rangeOpt && totalHint != null && rangeOpt.offset >= totalHint) {
              return new Response(null, {
                status: 416,
                headers: { ...cors, 'Accept-Ranges': 'bytes', 'Content-Range': 'bytes */' + totalHint },
              });
            }
          }
        }
        const obj = await env.MEDIA.get(key, rangeOpt ? { range: rangeOpt } : undefined);
        if (!obj) return json({ error: 'not_found' }, 404, cors);

        const headers = new Headers(cors);
        headers.set('Accept-Ranges', 'bytes');
        headers.set('Cache-Control', 'public, max-age=31536000, immutable');
        const ctype = (obj.httpMetadata && obj.httpMetadata.contentType) || guessMediaType(key);
        headers.set('Content-Type', ctype);
        if (obj.httpEtag) headers.set('ETag', obj.httpEtag);
        if (obj.uploaded) headers.set('Last-Modified', obj.uploaded.toUTCString());

        const total = typeof obj.size === 'number' ? obj.size : totalHint;
        let status = 200;
        if (rangeHdr && obj.range) {
          const start = obj.range.offset || 0;
          const length =
            obj.range.length != null ? obj.range.length : total != null ? total - start : null;
          if (length != null) headers.set('Content-Length', String(length));
          if (total != null && length != null) {
            headers.set('Content-Range', 'bytes ' + start + '-' + (start + length - 1) + '/' + total);
            status = 206;
          }
        } else if (total != null) {
          headers.set('Content-Length', String(total));
        }

        if (req.method === 'HEAD') return new Response(null, { status, headers });
        return new Response(obj.body, { status, headers });
      }
```

Helper (add once near your other helpers, e.g. next to `json` / `id`):

```js
function guessMediaType(key) {
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
```

If your `json()` helper does **not** accept a third `headers` argument, either:

1. Extend it: `function json(body, status = 200, extraHeaders = {}) { … merge extraHeaders … }`, or  
2. Replace the three `return json(..., cors)` lines with `new Response(JSON.stringify(...), { status, headers: { ...cors, 'Content-Type': 'application/json' } })`.

## Verify after deploy

```bash
KEY='YOUR-OBJECT-KEY.mp4'
curl -sI -H 'Range: bytes=0-1' "https://ruiningsubs-api.0788adm.workers.dev/media/$KEY"
# expect: HTTP/2 206, Accept-Ranges: bytes, Content-Range: bytes 0-1/…

curl -sI -X HEAD "https://ruiningsubs-api.0788adm.workers.dev/media/$KEY"
# expect: HTTP/2 200 or 206 (not 404), Accept-Ranges: bytes
```

## Note on the snippet you pasted

Several `||` operators were lost in the paste (e.g. `b.username  b.user  'anon'`). Restore them as `b.username || b.user || 'anon'` before saving the Worker, or the script will not parse.
