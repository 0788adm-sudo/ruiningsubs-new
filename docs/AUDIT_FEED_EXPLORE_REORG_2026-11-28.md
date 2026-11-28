# RuinExpose — FEED / EXPLORE reorganization audit

**Date:** 2026-11-28 (America/Bogota)  
**Baseline:** `main` @ `68928d1` (#172 + #171)

## Architecture (current)

| Layer | Reality |
|-------|---------|
| App shell | Single SPA in `index.html` (~40k lines) |
| Data | Supabase `posts` (+ tags, expires_at, extend_amount, views, likes…), `profiles`, coins, games APIs |
| Media | Cloudflare Workers (`workers/media-range.js`, `media-delete.js`) + R2 |
| Monetization | `api/extend.js`, `api/fc-spend.js`, `api/game-play.js` — **do not change** |
| GoonTok | `#panel-goontok` + vertical player — **leave untouched** |
| Videos catalog | `#panel-videos` with Most Viewed / Newest / Trending (already no Download in catalog) |

## Post classification (existing helpers)

- **EXTENDED feed** (`panel-feed` / `renderPosts`): timed exposures with active timers + extend UX.
- **TIMED / All Posts filter** (`isWallTimedPost`): active `expires` within ~60d, excludes PEA/ID and GoonTok clips. **Not identical** to the EXTENDED destination.
- **Games** (`isGameTaskWallPost`): roulette / dice / tic-tac-toe / challenge proofs via tags + `game_origin:*`.
- **ID / PEA** (`isPeaOrIdPost`): `generated_id`, `idcard`, `generated_pea`, `pea`.
- **Regular** (`isWallNormalPost` / text): timeless community posts.
- **Unified All** (`isWallUnifiedPost`): all of the above except GoonTok catalog-only rows. Single DB row — no copies.

## Gap vs product request (after #171/#172)

| Requirement | Status before this PR |
|-------------|----------------------|
| Nav = FEED · GOONTOK · CREATE · EXPLORE · PROFILE | **Missing** — nav was Extended · All Posts · GoonTok · Create · Explore |
| EXTENDED + ALL POSTS as tabs inside FEED | **Missing** — two separate bottom-nav destinations |
| All Posts filters = ALL · GAMES · ID · PEA · REGULAR POSTS · TIMED POSTS | **Partial** — All · Posts · Games · Extended only |
| Topics live in EXPLORE; open All Posts with topic filter | **Partial** — Topics UI lived on All Posts; Explore had a mini list |
| Explore ALL POSTS entry card | **Missing** |
| Explore DISCOVER / MAP / PLAY / TOOLS | **Done** in #172 |
| Videos catalog vs GoonTok | **Done** in #172 |
| Profile full publication history | **Done** in #171 (`profilePublicationsHtml`) |
| No payment / extend / game mechanic changes | Preserved |

## Implementation approach (this PR)

1. Bottom nav → Feed / GoonTok / Create / Explore / Profile.
2. Sticky in-FEED tabs EXTENDED | ALL POSTS (still reuse `panel-feed` + `panel-wall`; Feed nav stays active for both).
3. Expand All Posts chips to the six requested filters; split ID vs PEA; rename Timed.
4. Move Topics discovery into Explore; topic select → All Posts + `__wallTopicFilter` (no duplicate rows).
5. Add Explore → All Posts card; keep map / games / tools / videos wiring.
6. Update static tests; no Supabase migrations; no Worker / extend price changes.
