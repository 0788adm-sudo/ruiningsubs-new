-- Emergency restore for posts.id = 2343 (@LoserFagg "Ruin my life with blackmail")
-- Accidentally hard-deleted while reproducing the /api/delete-post moderation auth hole
-- (body.user="admin" + reason=moderation without credentials). That hole is now closed.
--
-- Run in Supabase SQL editor with a privileged role.
-- Fill image_url from R2 object prefix: media/1793884641766-8*.jpg
-- Comments for post_id 2343 still exist on the Cloudflare Worker.

INSERT INTO posts (
  id, username, title, description, tags, image_url,
  created_at, expires_at, views, likes_count, extensions_count, extend_amount,
  extenders, liked_by, featured, featured_until, saves_count, downloads_count, reactions
) OVERRIDING SYSTEM VALUE VALUES (
  2343,
  'LoserFagg',
  'Ruin my life with blackmail',
  'DM on telegram @loserfagg to get all my info',
  ARRAY['Faggot','blackmail','destroy','extremes','ruin','gender_man','man','ext_1440']::text[],
  '', -- TODO: paste full media URL from R2 (prefix 1793884641766-8…)
  '2026-11-05T13:17:24.154884+00:00',
  '2026-12-29T13:17:23+00:00',
  0, 0, 0, 1440,
  ARRAY[]::text[], ARRAY[]::text[],
  false, NULL, 0, 0, '{}'::jsonb
);

-- Keep unpinned (do not re-feature)
UPDATE posts SET featured = false, featured_until = NULL WHERE id = 2343;
