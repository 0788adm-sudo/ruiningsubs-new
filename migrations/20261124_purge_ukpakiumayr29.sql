-- Administrator permanent purge record for @UkPakiUmayr29 (alias @UkPaki29).
-- Content rows were removed by scripts/purge-user-ukpakiumayr29.js on 2026-11-24.
-- This migration is idempotent documentation + tombstone enforcement for DBs
-- that still hold residual rows.

-- 1) Ensure tombstone profiles remain (username reserved; cannot republish as active)
UPDATE public.profiles
SET status = 'deleted',
    banned = true,
    suspended = false,
    avatar_url = null,
    xp = 0,
    updated_at = now()
WHERE lower(username) IN ('ukpakiumayr29', 'ukpaki29');

-- 2) Drop any remaining posts under those usernames only (never ownership)
DELETE FROM public.posts
WHERE lower(username) IN ('ukpakiumayr29', 'ukpaki29');

-- 3) Clear username_aliases for the purged account when the table exists
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'username_aliases'
  ) THEN
    DELETE FROM public.username_aliases
    WHERE lower(current_username) IN ('ukpakiumayr29', 'ukpaki29')
       OR lower(alias) IN ('ukpakiumayr29', 'ukpaki29', 'UkPaki29', 'UkPakiUmayr29');
  END IF;
END $$;
