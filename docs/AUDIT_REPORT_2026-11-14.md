# RuinExpose — Audit & Stabilization Report

**Date:** 2026-11-14 (America/Bogota)  
**Branch:** `cursor/platform-audit-stabilize-98bd`  
**Backup:** `backups/audit-2026-11-14/` (+ `ROLLBACK.md`)

---

## 1. Problems found

| # | Area | Severity | Status |
|---|------|----------|--------|
| P1 | Views only hit Cloudflare; Supabase stayed at 0 | Critical | Fixed in #89 (already on main) |
| P2 | Detail UI used a detached post object → always showed 0 | Critical | Fixed in #89 |
| P3 | Exposure Map Explore preview = blue empty rectangle (`#0c1b33` + Esri ocean zoom + fragile Leaflet load) | Critical | Fixed this PR |
| P4 | Map pins stored **street addresses** + precise lat/lng | Critical (privacy) | Fixed this PR (sanitize + fuzz + maxZoom 11) |
| P5 | Wall media black box (no `onerror` recovery) | High | Fixed this PR |
| P6 | Wall “👁 N VIEWS” badge not wired to `data-views-id` | Medium | Fixed this PR |
| P7 | RANDOM 3 thumbs hide on error (`is-broken`) — looks empty | Medium | Pre-existing; cards hide broken thumbs by design |
| P8 | `posts.deletion_tier` column missing in production (select → 400) | Medium | Already avoided in feed queries |
| P9 | Pin board notifs lack payment/source provenance | Medium | Documented; no price/rule change |
| P10 | FEATURED_PROFILES (`loserfagg`) auto-extends pin window in UI | Low/by design | Documented — intentional |
| P11 | Admin password not in HTML (good); gate uses Worker `/admin/login` | OK | Verified |
| P12 | Supabase **anon** key is public in client (expected for SPA) | Info | Do not confuse with service_role |
| P13 | Near-duplicate posts: 19 groups / 43 rows | Low | Not auto-deleted |

---

## 2. Technical causes

### Views (already shipped #89)
- `POST CF /posts/:id/view` returns ok but does not update Supabase.
- `rememberFeedPost` returned a different object than the one mutated by `bumpViews`.
- Cache refresh could overwrite live totals with `views:0`.

### Map blue rectangle
- Preview CSS background was `#0c1b33` (blue).
- Esri Dark Gray at zoom 1 is mostly ocean → looks empty.
- Leaflet from unpkg with no CDN fallback; `invalidateSize` too weak when panel becomes visible.

### Map privacy
- Live pins include values like `Nürnberg 90473 jauerstraße 22` and house-level coordinates.
- No max zoom cap (was 16) → street-level tiles.

### Wall black media
- ID card URL is valid (HTTP 200 JPEG).
- Wall `<img>` had no `onerror` retry / placeholder → intermittent network left a black frame.

---

## 3. Corrections in this PR

1. Map basemap → Carto dark primary + Esri fallback; Leaflet jsDelivr fallback; stronger `invalidateSize`.
2. Privacy: `sanitizePlaceText`, `fuzzCoords` (~1–2 km), `MAP_MAX_ZOOM=11`, sanitize on save/display/merge.
3. Wall views badge → `data-views-id` (live sync with persist path).
4. Wall media → `publicMediaUrl` + `__nfImgRetry`.
5. Logical backup + rollback procedure under `backups/audit-2026-11-14/` (gitignored).

**Not changed (per rules):** prices, roulette odds, payment links, algorithms, historical view totals, user/post deletes.

---

## 4. Functions tested

| Test | Result |
|------|--------|
| `scripts/test-views-persistence.js` | Pass (incl. live Supabase) |
| `scripts/test-views-open-reopen.js` | Pass (prior) |
| `scripts/test-map-privacy-media.js` | Pass |
| `scripts/test-js-syntax.js` | Pass |
| Browser map smoke (Chrome headless mobile viewport) | Leaflet loaded; tiles rendered on Explore + full map |
| Media URL for Anon_6052 ID card (`/media/1794690770569-…jpg`) | HTTP 200, JPEG 1000×630 |
| Post 2907 views in DB | `2` (matches UI `displayViews` → 4) |

---

## 5. PC / mobile

- Map smoke: 390×844 mobile viewport — tiles OK.
- Full Safari/Android device lab not available in this VM; preview deploy should be rechecked on iPhone Safari after merge.
- Wall media retry is client-side and applies to both desktop and mobile.

---

## 6. Historical data integrity

- Backup snapshot: **1655** posts, **views_sum 3373**, **814** profiles.
- No destructive SQL / no view resets / no mass deletes executed.
- Expired `featured_until` rows left intact (client already filters by time).

---

## 7. Follow-up from agent audits (applied in same PR)

From [Audit views media security](bc-a5b2b8ef-79e4-5df7-aa15-7aafe3a9a68d) + [Audit map and pins](bc-218a66bb-a20e-56ce-b20e-3a48b8bb0334):

| Follow-up | Action |
|-----------|--------|
| Worker `/media` → R2 rewrite missing on Wall/ID | `mergePostImages` now maps every URL through `publicMediaUrl` |
| Wall quiet refresh could lower views | `Math.max` + localViewsFloor on in-place merge |
| Ungated `adminPin` / approve helpers | Client grant after FC spend / Triki server OK / admin session; `approveFeature` + `approvePinPublish` require `isSiteAdmin()` |
| Hardcoded `kenny00` in `kenny-touchard.html` | Removed; device-local password bootstrap only |
| Impression + detail both bump views | **Left as current product rule** (not artificial inflation change) |

## 8. Remaining / needs owner action

1. **Full physical DB backup** via Supabase Dashboard PITR / `pg_dump` (service_role) — anon export is incomplete.
2. **Cloudflare Worker** must reject unauthenticated writes to `__PIN_BOARD__` / `__PIN_REWARDS__` (client gate is defense-in-depth only).
3. Worker should persist `/view` into Supabase (or shared store).
4. **Pin provenance**: store `source` (`fc` / `paypal` / `triki` / `admin`) on board messages.
5. Triki: server must verify session wins, not trust body `wins` alone.
6. **Existing street-address pins** on CF: display sanitized; old raw messages remain until re-save.
7. Optional: add `deletion_tier` column when ready.
8. Staging PayPal/Throne sandbox run by the owner.

---

## Success criteria (honest)

- Views persistence path: **working** (DB + UI for sampled Wall ID post).
- Map: **tiles render** in automated mobile viewport; blue empty CSS removed.
- Privacy: **new pins** cannot publish street-level place text / exact coords.
- Platform was **not** rebuilt; no price/reward changes.
- Full “every section on every device” manual QA still needs owner pass on production after deploy.
