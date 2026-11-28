# RuinExpose — Stories system (definitive)

**Date:** 2026-11-28 (America/Bogota)  
**Branch:** `cursor/stories-system-71ff`

## Summary

Replaced the five random photos under the Ruining Subs logo with a live Stories carousel. Stories are server-backed (24h TTL), publishable without registration, free to delete for the publisher or admin, with public views/likes and profile rings.

## Files

| File | Change |
|------|--------|
| `lib/stories.js` | Server Stories API (list/publish/view/like/delete/migrate) |
| `api/game-play.js` | Routes `stories_*` actions (no new serverless fn — Hobby cap) |
| `migrations/20261128_stories_system.sql` | Optional native `stories` / `story_views` / `story_likes` tables |
| `index.html` | Banner carousel, composer, viewer, profile ring, admin Stories tab, feed exclusion |
| `scripts/test-stories-system.js` | Static + live checks |

## Database

**Active storage (works today):** `posts` rows tagged `__story__`  
- `image_url` = media  
- `expires_at` = created + 24h (server-enforced)  
- `description` = JSON meta (`kind`, `owner_hash`, `anon_id`, `legacy_id`, …)  
- `views` / `likes_count` / `liked_by` = counters  
- Soft-delete: tag `story_deleted` + expire immediately (stats retained)

**Optional migration:** apply `migrations/20261128_stories_system.sql` on Supabase for dedicated tables; API auto-detects and prefers them.

## Legacy migration (`@LoserFagg`)

- Source: CF notifs `__STORIES__` id `st_mwzixonpihq`
- Migrated once into posts id **4321** (same media URL, created_at preserved, views kept)
- Not duplicated on subsequent runs (`legacy_id` guard)
- Shown in carousel while within 24h; profile ring works for `@LoserFagg`

## Anonymous sessions

- Visitors use stable `rs_anon_id` + `owner_token` (hashed server-side)
- Token stored in `localStorage.rs_story_owner_tokens` for same-device free delete
- Registered users auto-associate by username; no Coins for publish/delete

## Views & likes

- Views: notification receipts `__STORY_VIEW__{id}` prevent reload duplicates
- Likes: `liked_by` + `likes_count`; one key per session/user; unlike supported
- Owner/admin can open Stats in the viewer

## Deletion & permissions

- Always **free** (`cost: 0`) — no Coins, no paid delete requests
- Owner: username match **or** `owner_token` **or** matching `anon_id`
- Admin: Bearer CF admin token verified server-side; Admin → Stories tab
- Non-owners get `403 forbidden`

## Expiry

- Exact 24h from `created_at` → `expires_at`
- List endpoints filter `expires_at > now()` and non-deleted on the server
- Expired stories never return to the carousel or profile rings

## Feed isolation

Stories are excluded from Extended, All Posts, wall filters, and search pools via `isStoryPost` / `__story__` tag checks.

## Tests run

1. `node scripts/test-js-syntax.js` — PASS  
2. `node scripts/test-stories-system.js` — PASS (incl. live LoserFagg)  
3. Local `/api/game-play` smoke: anon publish → view counted → like → non-owner delete forbidden → owner delete free — PASS  
4. Lib probe: duplicate view not counted; LoserFagg remains sole active legacy story — PASS  
