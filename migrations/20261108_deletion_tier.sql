-- Deletion Tier system for RuinExpose posts (ExposureHub-style).
-- Safe to run multiple times. Existing rows default to 'deletable' so legacy
-- free-delete / timed-paid behavior is preserved until publishers opt in.
--
-- Tier meanings:
--   deletable  — owner may delete free
--   locked     — owner voluntary delete costs 50 FC
--   permanent  — owner voluntary delete costs 50 FC (marked permanent)
--
-- Admin moderation / privacy / consent removals are NOT gated by this column
-- (handled in /api/delete-post with reason=moderation|privacy).

ALTER TABLE public.posts
  ADD COLUMN IF NOT EXISTS deletion_tier text;

DO $$
BEGIN
  -- Normalize empty values
  UPDATE public.posts
  SET deletion_tier = 'deletable'
  WHERE deletion_tier IS NULL OR btrim(deletion_tier) = '';

  -- Constrain allowed values (drop+recreate so re-runs stay idempotent)
  ALTER TABLE public.posts DROP CONSTRAINT IF EXISTS posts_deletion_tier_check;
  ALTER TABLE public.posts
    ADD CONSTRAINT posts_deletion_tier_check
    CHECK (deletion_tier IN ('deletable', 'locked', 'permanent'));
EXCEPTION WHEN others THEN
  -- Older Postgres / missing privileges: column still usable; app also stores del: tags.
  RAISE NOTICE 'deletion_tier constraint skipped: %', SQLERRM;
END $$;

CREATE INDEX IF NOT EXISTS posts_deletion_tier_idx
  ON public.posts (deletion_tier);

COMMENT ON COLUMN public.posts.deletion_tier IS
  'Owner voluntary delete policy: deletable (free), locked (50 FC), permanent (50 FC). Admin/moderation/privacy overrides.';
