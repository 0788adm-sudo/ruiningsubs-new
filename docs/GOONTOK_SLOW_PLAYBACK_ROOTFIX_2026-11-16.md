# GoonTok — slow playback root-cause fix

**Date:** 2026-11-16 (America/Bogota)  
**Branch:** `cursor/goontok-slow-playback-rootfix-7172`

## Root cause

The roulette clip that took **>2 minutes** to start (**post 3122 · Humiliation video**) was a valid MP4, but:

| Check | Finding |
|-------|---------|
| Size | **19 842 764 bytes (~19.8 MB)** for **16.8 s** |
| Resolution / codec | **1920×1080 H.264 Main** + AAC @ **~9.4 Mbps** |
| `moov` position | **After `mdat`** (offset **19 829 883** · **99.94%** into the file) |
| Fast Start | **No** |
| R2 Range | **HTTP 206** · `Accept-Ranges: bytes` · TTFB ~50–120 ms |
| Worker `/media` Range | **Still broken**: Range GET → **full HTTP 200** body; HEAD → **404** |
| vthumb | **Missing** (no durable poster) |
| Upload path | Wall / roulette / game proofs used `uploadPostPhotos` → `uploadCfFile` and **skipped** `ensureMp4FastStart` (only the GoonTok video composer remuxed) |

On iPhone/Safari, moov-at-end + a ~20 MB high-bitrate phone recording forces the browser to pull nearly the whole object before metadata/first frame → **Preparing → Loading → Buffering** for minutes. Other feed clips were smaller / lower bitrate, so they “worked” despite also often lacking Fast Start.

Secondary amplifier: any `fetch()` through the live Worker still downloads **entire** MP4s when Range is requested (dashboard patch not deployed). `<video>` already uses public R2 (correct 206).

## Files modified

- `index.html` — Wall/roulette `uploadPostPhotos` Fast Start + local vthumb; `createPost` stamps `video`/`goontok`/`vthumb:`; optimize worker yields to active players and remuxes Fast Start
- `api/videos.js` — media proxy forwards HTTP **416**
- `workers/media-range.js` — Range/206/416/HEAD hardening (deploy to CF dashboard)
- `workers/MEDIA_RANGE_DASHBOARD_PATCH.md` — live status + paste instructions
- `scripts/repair-mp4-faststart.js` — remux existing R2 objects + patch SB `image_url` / vthumb
- `scripts/test-goontok-slow-rootfix.js` — live timing probes
- `scripts/test-goontok-playback-fix.js` — Wall Fast Start guard
- `docs/GOONTOK_SLOW_PLAYBACK_ROOTFIX_2026-11-16.md` — this report

**Not changed:** Wall layout/CSS system, Explore map, image posts, D1 migration, payments.

## Changes performed

1. **New Wall / roulette / game video uploads** remux MP4 Fast Start before R2 put (same copy remux as GoonTok composer; originals kept on remux failure).
2. **Local JPEG vthumb** from the file bytes at publish (no remote MP4 download for thumbs).
3. **Repaired live posts** (new R2 keys, old objects kept):

| id | title | result |
|----|-------|--------|
| **3122** | Humiliation video | Fast Start + vthumb |
| **3111** | Beg on camera | Fast Start + vthumb (**HEVC** — Safari OK; desktop Chrome Linux often cannot decode) |
| **3040** | fuck machine… | Fast Start + vthumb |
| **3014** | If you're horny… | Fast Start + vthumb |
| **3001** | Handfuck | Fast Start + vthumb |

4. Background optimize no longer races an active GoonTok/Wall player; also Fast Starts when it does remux.
5. Worker Range patch updated (still **must be pasted/deployed** in Cloudflare — this repo cannot publish the live Worker).

## Tests executed

| Test | Result |
|------|--------|
| `scripts/test-goontok-slow-rootfix.js` | Pass (live R2 206 + timings) |
| `scripts/test-goontok-playback-fix.js` | Pass |
| `scripts/test-multimedia-audit.js` | Pass |
| `scripts/test-goontok-playback.js` | Pass |
| `scripts/test-js-syntax.js` | Pass |
| ffmpeg decode of remuxed 3122/3040/3014 | Pass |
| Desktop Chrome · `/p/3122` | **~2 s** to first frames (was minutes) |
| Desktop Chrome · `/p/3111` | No play — **HEVC unsupported** in this Linux Chrome (not a Fast Start regression) |
| Desktop Chrome · `/p/3040` `/p/3014` `/p/3001` | Files remuxed + R2 206 OK; Wall UI automation stayed on “Starting…” (inconclusive UI; decode/Range OK) |
| GoonTok feed swipe (desktop automation) | Scroll fluid; in-feed autoplay not confirmed in automation |
| **iPhone Safari device** | **Not run in this VM** — must be confirmed on a physical iPhone after deploy |

### Playback start timings (network / metadata proxy)

Cold first Progressive chunk on R2 after repair (America/Bogota run):

| id | cold first-chunk | warm | Fast Start | notes |
|----|------------------|------|------------|-------|
| 3122 | **92 ms** | 68 ms | yes | problem roulette — fixed |
| 3111 | **56 ms** | 64 ms | yes | HEVC |
| 3040 | 69 ms | 54 ms | yes | remuxed |
| 3014 | 66 ms | 61 ms | yes | remuxed |
| 3001 | 70 ms | 52 ms | yes | remuxed |

UI-measured start (desktop Chrome detail): **3122 ≈ 2 s** open→play.

Worker Range still returns **full 200** (~19 MB body for `bytes=0-1`) — documented pending deploy.

## Pending

1. **Deploy `workers/media-range.js`** to the live Cloudflare Worker (Range 206 / HEAD / 416).
2. **Physical iPhone Safari** confirmation of 3122 / 3111 / neighbors after frontend deploy.
3. Optional: batch `repair-mp4-faststart.js` across the rest of the catalog.
4. Optional: HEVC→H.264 transcode path for non-Safari (3111) — out of scope for Fast Start-only repair.
