-- RuinExpose Stories system (24h, free delete for owner/admin).
-- Stories are also mirrored into posts tagged __story__ for environments
-- where this migration has not been applied yet. Safe to run multiple times.

CREATE TABLE IF NOT EXISTS public.stories (
  id bigserial PRIMARY KEY,
  legacy_id text UNIQUE,
  username text NOT NULL,
  anon_id text,
  account_type text NOT NULL DEFAULT 'anonymous',
  media_url text NOT NULL,
  thumb_url text,
  avatar_url text,
  owner_token_hash text NOT NULL,
  views_count integer NOT NULL DEFAULT 0,
  likes_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  deleted_at timestamptz,
  deleted_by text,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS stories_active_idx
  ON public.stories (expires_at DESC, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS stories_username_idx
  ON public.stories (lower(username));

CREATE INDEX IF NOT EXISTS stories_anon_idx
  ON public.stories (anon_id)
  WHERE anon_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.story_views (
  story_id bigint NOT NULL REFERENCES public.stories(id) ON DELETE CASCADE,
  viewer_key text NOT NULL,
  viewed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (story_id, viewer_key)
);

CREATE TABLE IF NOT EXISTS public.story_likes (
  story_id bigint NOT NULL REFERENCES public.stories(id) ON DELETE CASCADE,
  liker_key text NOT NULL,
  liked_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (story_id, liker_key)
);

COMMENT ON TABLE public.stories IS
  'Ephemeral user stories. Visible only while deleted_at IS NULL AND expires_at > now(). Delete is always free for owner or admin.';

COMMENT ON COLUMN public.stories.owner_token_hash IS
  'SHA-256 hex of private owner token. Anonymous publishers prove ownership without a registered account.';
