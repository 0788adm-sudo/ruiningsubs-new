-- Permanent account identity for username renames.
-- Content must link by user_id (auth UUID / stable account id), not by display username.
-- Safe to run multiple times. App still works if columns/tables are missing
-- (falls back to username + anon_id tags + alias board).

-- 1) Stable account id on profiles (Supabase auth.users.id as text, or anon_<id>)
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS user_id text;

CREATE UNIQUE INDEX IF NOT EXISTS profiles_user_id_uidx
  ON public.profiles (user_id)
  WHERE user_id IS NOT NULL AND length(user_id) > 0;

COMMENT ON COLUMN public.profiles.user_id IS
  'Permanent account id (auth UUID or anon_<session>). Username is display-only.';

-- 2) Stable account id on posts / comments / saves
ALTER TABLE public.posts
  ADD COLUMN IF NOT EXISTS user_id text;

CREATE INDEX IF NOT EXISTS posts_user_id_idx
  ON public.posts (user_id)
  WHERE user_id IS NOT NULL;

COMMENT ON COLUMN public.posts.user_id IS
  'Permanent author account id. username column is a denormalized display cache.';

ALTER TABLE public.comments
  ADD COLUMN IF NOT EXISTS user_id text;

CREATE INDEX IF NOT EXISTS comments_user_id_idx
  ON public.comments (user_id)
  WHERE user_id IS NOT NULL;

ALTER TABLE public.user_saves
  ADD COLUMN IF NOT EXISTS user_id text;

CREATE INDEX IF NOT EXISTS user_saves_user_id_idx
  ON public.user_saves (user_id)
  WHERE user_id IS NOT NULL;

-- 3) Alias map: old usernames → current username + permanent user_id
CREATE TABLE IF NOT EXISTS public.username_aliases (
  alias text PRIMARY KEY,
  user_id text NOT NULL,
  current_username text NOT NULL,
  previous_username text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS username_aliases_user_id_idx
  ON public.username_aliases (user_id);

CREATE INDEX IF NOT EXISTS username_aliases_current_idx
  ON public.username_aliases (lower(current_username));

COMMENT ON TABLE public.username_aliases IS
  'Maps every historical username (and case variants) to the permanent user_id and current display username.';

-- 4) One-shot repair for known rename (idempotent)
-- Previous: UkPaki29 / ukpaki29  →  current: UkPakiUmayr29
-- Permanent link already present on posts as tags anon_id:amwk2a8nj29r3kaxny6
DO $$
DECLARE
  uid text := 'anon_amwk2a8nj29r3kaxny6';
  cur text := 'UkPakiUmayr29';
BEGIN
  -- Stamp posts that still lack user_id but match current / old usernames or anon tag
  UPDATE public.posts
  SET user_id = uid
  WHERE (user_id IS NULL OR user_id = '')
    AND (
      lower(username) IN ('ukpaki29', 'ukpakiumayr29')
      OR tags @> ARRAY['anon_id:amwk2a8nj29r3kaxny6']::text[]
    );

  UPDATE public.posts
  SET username = cur
  WHERE lower(username) IN ('ukpaki29')
    AND lower(username) <> lower(cur);

  -- Alias rows
  INSERT INTO public.username_aliases (alias, user_id, current_username, previous_username)
  VALUES
    ('ukpaki29', uid, cur, 'UkPaki29'),
    ('ukpakiumayr29', uid, cur, 'UkPaki29'),
    ('UkPaki29', uid, cur, 'UkPaki29'),
    ('UkPakiUmayr29', uid, cur, 'UkPaki29')
  ON CONFLICT (alias) DO UPDATE
    SET user_id = EXCLUDED.user_id,
        current_username = EXCLUDED.current_username,
        previous_username = EXCLUDED.previous_username,
        updated_at = now();

  -- Prefer current profile row; drop orphan display clone if empty
  UPDATE public.profiles
  SET user_id = uid
  WHERE lower(username) = lower(cur)
    AND (user_id IS NULL OR user_id = '');

  -- Remove orphan profile only when it is the old handle and current exists
  IF EXISTS (SELECT 1 FROM public.profiles WHERE lower(username) = lower(cur)) THEN
    DELETE FROM public.profiles
    WHERE lower(username) = 'ukpaki29'
      AND lower(username) <> lower(cur);
  END IF;
END $$;
