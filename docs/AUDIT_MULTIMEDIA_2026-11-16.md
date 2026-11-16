# RuinExpose — Multimedia system audit & repair

**Date:** 2026-11-16 (America/Bogota)  
**Branch:** `cursor/multimedia-audit-fix-f4b5`

---

## Root cause

Two independent host behaviors were fighting each other, and the Wall player compounded them:

| Host | Range / 206 | CORS | Notes |
|------|-------------|------|-------|
| Cloudflare R2 `pub-…r2.dev` | Yes (`Accept-Ranges: bytes`, HTTP 206) | **No** (`Access-Control-Allow-Origin` missing; OPTIONS 403) | Correct for `<video>` / `<img>` progressive playback |
| Worker `…workers.dev/media/*` | **No** (Range ignored → full 200) | Yes (`*`) | Correct for `fetch()` / canvas; HEAD returns 404 |

Client code already rewrote Worker URLs → R2 for playback (good for Safari). Remaining failures:

1. **Wall “Preparing video…” forever**  
   `lazyVideoHtml` / `warmVideoThumb` used `#t=0.1` media fragments. New uploads often have **`moov` at end of file** (no faststart). Fragment seeks hang before metadata is ready, so `loadeddata` never fires and the overlay never clears — even when native controls later show a duration.

2. **Incomplete event / error handling**  
   Overlay hid only on `loadeddata` / `playing`. No timeout, no Retry, no `readyState` race check after attaching listeners.

3. **CORS fetch against R2**  
   Optimize worker, downloads, and poster canvas used R2 URLs with `fetch({mode:'cors'})` → console CORS / `ERR_FAILED`. Images via `<img>` were mostly fine (no CORS needed); black frames were often stuck video posters, not corrupt JPEGs.

Live probes (posts 3014 / 3010 / images): both hosts return HTTP 200 bodies with correct MIME; files are not missing from storage.

---

## Files / components affected

- `index.html` — media URL helpers, Wall/feed lazy player, image retry, downloads, optimize probe, challenge/evidence media, GoonTok poster shell, Videos list thumbs  
- `scripts/test-multimedia-audit.js` — new regression + live probe  
- `scripts/test-safari-video-player.js`, `scripts/test-goontok-playback.js` — aligned with new behavior  
- `docs/AUDIT_MULTIMEDIA_2026-11-16.md` — this report  

Not changed: auth, likes/reactions/comments/saves, roulette/games rules, Wall layout CSS system, Cloudflare dashboard config, historical posts/DB rows (no re-upload / no deletes).

---

## Changes made

1. **Unified media URL layer**
   - `mediaObjectKey` / `publicMediaUrl` → R2 for element playback (Range)
   - `fetchableMediaUrl` → Worker for `fetch` / canvas (CORS)

2. **Lazy video player repair**
   - Removed `#t=0.1` from Wall/lazy preview path (hung on moov-at-end MP4s)
   - Cards start with `preload=none` and no `src` — warm/activate attach R2 URL only for visible/tapped clips (avoids N× full-file metadata fetches starving playback)
   - `bindLazyVideoEvents`: `loadedmetadata`, `loadeddata`, `canplay`, `playing`, `waiting` (debounced), `stalled`, `timeupdate`, `ended`, `error`
   - Timeout + **Retry** UI — never leave “Preparing video…” forever
   - `readyState` sync after attaching listeners

3. **Image retry**
   - `__nfImgRetry`: R2 → Worker → soft placeholder; Wall sets `data-orig`

4. **Fetch paths**
   - Downloads + optimize worker use Worker URL; Range probe prefers R2 then falls back

5. **GoonTok / Videos thumbs**
   - Poster shells no longer force media-fragment seeks

---

## Tests executed

| Test | Result |
|------|--------|
| `scripts/test-js-syntax.js` | Pass |
| `scripts/test-multimedia-audit.js` (incl. live R2 206 + Worker CORS) | Pass |
| `scripts/test-safari-video-player.js` | Pass |
| `scripts/test-goontok-playback.js` (incl. ≥5 live playable mp4s) | Pass |
| `scripts/test-video-fetch-restore.js` | Pass |
| `scripts/test-wall-video-tabs.js` | Pass |
| `scripts/test-map-privacy-media.js` | Pass |
| Production smoke (pre-fix): Feed/Detail images OK; Wall Preparing stuck; GoonTok OK; console CORS on R2 fetch | Documented |

---

## Sections covered

| Section | Status after fix |
|---------|------------------|
| Wall / Muro videos | Fixed player path (R2 + events + Retry) |
| Feed / Extend images & videos | Same shared `lazyVideoHtml` / `publicMediaUrl` |
| GoonTok | Kept working player; safer poster shell |
| Post detail gallery | Shared media helpers |
| Profiles / tasks / evidence | Worker→R2 rewrite + lazy video where applicable |
| Downloads | Worker CORS fetch |
| Thumbnails / vthumb | Unchanged publish path; preview no longer depends on `#t=` |

---

## Remaining / owner follow-ups

1. **R2 CORS** — optional bucket CORS for `www.ruinexpose.com` would let canvas/fetch use R2 directly; not required after `fetchableMediaUrl`.
2. **Worker Range** — enabling HTTP Range/206 on `/media/*` would make Worker alone Safari-safe; until then keep R2 for `<video>`.
3. **Upload faststart** — remux new MP4s with `moov` at front (server-side) to speed first paint; playback still works via R2 Range without it.
4. **iPhone Safari device lab** — confirm on a physical iPhone after deploy (VM cannot run real Safari iOS).
5. Worker `POST /posts` D1 schema bug (16 vs 18 cols) remains documented; SB fallback still used.
