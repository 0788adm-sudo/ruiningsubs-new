# RuinExpose — Performance, Wall hierarchy & GoonTok audit

**Date:** 2026-11-16 (America/Bogota)  
**Branch:** `cursor/perf-wall-goontok-a7df`

---

## 1. Problems found

| # | Area | Severity | Status |
|---|------|----------|--------|
| P1 | Wall DOM order: Stories + RANDOM 3 buried under tagline/filters | High (UX) | Fixed |
| P2 | `openDetail` awaited CF+SB before painting known Wall/GoonTok posts → long “Opening…” | Critical | Fixed |
| P3 | Every Wall visit called `loadNormalFeed()` (route + `showPanel` double-fetch) | High | Fixed |
| P4 | `__wallFetchedAt` set but never used as TTL → unnecessary network on section hops | High | Fixed |
| P5 | Tab visibility return remounted Wall non-quietly | Medium | Fixed |
| P6 | `fetchVideoPosts` fan-out: `/api/videos` + mp4 + webm/mov/tags REST + supabase-js ×3 | High | Fixed (gated) |
| P7 | RANDOM 3 thumbs: raw `<img>` without retry → black/empty on transient fails | Medium | Fixed |
| P8 | Unbounded `follows` / banned-profile selects | Low | Fixed (limits) |
| P9 | No idle prefetch between Wall ↔ GoonTok | Medium | Fixed |
| P10 | R2 CORS / Worker Range gaps | Known | Documented (prior multimedia audit) |
| P11 | CF `/avatars` 404 storms on every feed paint | Medium | Mitigated (session soft-disable + SB path) |

---

## 2. Files modified

- `index.html` — Wall hierarchy, navigation TTL, cache-first detail, video catalog fan-out gate, day-photo UI, query limits, prefetch
- `scripts/test-wall-mobile-ui.js` — new Wall order assertions
- `scripts/test-perf-nav-wall-goontok.js` — new regression guards
- `scripts/local-dev-server.js` — serve `/api/videos` locally
- `docs/AUDIT_PERF_WALL_GOONTOK_2026-11-16.md` — this report

**Not changed:** payments, balances, permissions, admin panel rules, likes/views/comments algorithms, historical posts/files.

---

## 3. Corrections & optimizations

### Wall hierarchy
Stories → Photos of the day (RANDOM 3) → community tagline → Post / Extend / IDs·PEA / Roulette → Generate ID/PEA → sort → feed.

### Instant navigation
- `refreshWallSection` + `WALL_CACHE_TTL_MS` (45s): return to Wall paints cache, quiet refresh only when stale
- Route `/wall` no longer double-calls `loadNormalFeed`
- Visibility return uses quiet refresh
- `scheduleSectionPrefetch` warms GoonTok from Wall (and Wall from GoonTok) after idle

### Post open
- Cache-first `openDetail`: local pools paint immediately; `ensureFeedPost` verifies in background; deleted → `showPostGone`

### GoonTok / catalog
- Skip webm/mov/tag + supabase-js triple query when primary catalog ≥ 24 ids
- Keep existing IntersectionObserver, neighbor `preload=auto`, soft-fail + Retry, Loading hard cap

### Media
- Day photos use `wallImageHtml` + `__nfImgRetry` (R2 → Worker → Retry)
- Dual-host `publicMediaUrl` / `fetchableMediaUrl` unchanged

---

## 4. Tests executed

| Test | Result |
|------|--------|
| `scripts/test-js-syntax.js` | Pass |
| `scripts/test-wall-mobile-ui.js` | Pass |
| `scripts/test-perf-nav-wall-goontok.js` | Pass |
| `scripts/test-multimedia-audit.js` (live R2 206 + Worker CORS) | Pass |
| `scripts/test-goontok-playback.js` (≥5 playable mp4s) | Pass |
| `scripts/test-video-fetch-restore.js` | Pass |
| `scripts/test-wall-media-placeholders.js` | Pass |
| `scripts/test-goontok-ux-safari.js` | Pass |
| `scripts/test-global-scroll-mobile.js` | Pass |
| `scripts/test-deleted-post-gone.js` | Pass |
| `scripts/test-feed-loading.js` | Pass |
| Browser: Wall hierarchy + open posts + GoonTok | See walkthrough artifacts |

Pre-existing failures (not introduced): `test-safari-video-player.js` (postCardHtml assertion), `test-section-routes-gallery.js` (active timer far-future).

---

## 5. Remaining / owner follow-ups

1. Optional R2 bucket CORS for `www.ruinexpose.com` (canvas/fetch without Worker).
2. Worker `/media` HTTP Range/206 so Worker alone is Safari-safe.
3. Upload faststart remux (`moov` at front) for faster first paint.
4. Physical iPhone Safari lab after deploy.
5. Durable server-side video thumbnails at publish time (client still fills posters via frame capture).
