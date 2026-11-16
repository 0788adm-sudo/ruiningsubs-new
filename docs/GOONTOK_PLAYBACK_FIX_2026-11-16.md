# GoonTok — definitive playback fix

**Date:** 2026-11-16 (America/Bogota)  
**Branch:** `cursor/goontok-playback-faststart-b16e`

## Goal

Fast first frame, no black screens / infinite Loading, no unnecessary full downloads.

## Phase results

### Phase 1 — Fast Start
- Detect MP4 `moov` after `mdat` during upload.
- Remux with the same semantics as `ffmpeg -c copy -movflags +faststart` (no recompress).
- Validate remuxed bytes before upload; on failure keep the original (never publish a broken processed file).
- Resolution / audio / duration preserved (copy remux).

### Phase 2 — Thumbnails
- Real JPEG from the local file at publish → R2 → `vthumb:` + `thumb_url`.
- Publish path no longer calls `grabVideoPosterFromUrl` (full remote download).
- Controlled recovery:
  - `maybePersistPosterFromActivePlayer` (one-at-a-time from the active player frame).
  - `scripts/backfill-vthumbs.js` (ffmpeg frame extract + R2 upload + tag patch).

### Phase 3 — Duplicate requests
- Removed `gt-poster-vid` secondary players.
- `scheduleVideoPosterFill` is cache-only.
- Videos grid no longer mounts hidden `<video src>` for thumb generation.
- Single `data-gt-vid` player per slide.

### Phase 4 — Preload budget
- Visible: `preload=auto`.
- Next only: `preload=metadata`.
- Prev + far: `preload=none` + unload (no competing 15 MB downloads).

### Phase 5 — Worker / media Range
- Media Range proxy lives in `api/videos.js` (`handleMediaProxy`); `vercel.json` rewrites `/api/media` → `/api/videos` so Hobby stays ≤12 serverless functions.
- Supports `206`, `Content-Range`, `Accept-Ranges`, `Content-Length`, `HEAD`, CORS.
- `workers/media-range.js`: drop-in Worker patch for `/media` (deploy separately).
- `<video>` still uses public R2 directly (already Range-correct).

### Phase 6 — Tests
- `node scripts/test-goontok-playback-fix.js`
- Existing GoonTok / multimedia / Safari static suites
- Live R2 Range probes
- iPhone Safari: must be confirmed on a physical device after deploy (VM cannot run iOS Safari).

## Rules honored
- Wall / Explore / navigation / post structure untouched.
- No delete of existing videos.
- No new playback architecture (R2 for elements; CORS path for fetch/canvas).
