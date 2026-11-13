-- Free deletion flag + private owner token hash for anonymous same-device delete.
-- Safe to run multiple times. App still works if columns are missing (del: tags + username).

ALTER TABLE public.posts
  ADD COLUMN IF NOT EXISTS free_deletion_enabled boolean;

ALTER TABLE public.posts
  ADD COLUMN IF NOT EXISTS owner_token_hash text;

DO $$
BEGIN
  -- Sync free_deletion_enabled from deletion_tier when present.
  UPDATE public.posts
  SET free_deletion_enabled = CASE
    WHEN lower(coalesce(deletion_tier, '')) = 'deletable' THEN true
    WHEN lower(coalesce(deletion_tier, '')) IN ('locked', 'permanent') THEN false
    ELSE free_deletion_enabled
  END
  WHERE free_deletion_enabled IS NULL
     OR (deletion_tier IS NOT NULL AND btrim(deletion_tier) <> '');

  -- Default remaining NULLs to false (legacy / unknown → paid path when timed).
  UPDATE public.posts
  SET free_deletion_enabled = false
  WHERE free_deletion_enabled IS NULL;
EXCEPTION WHEN others THEN
  RAISE NOTICE 'free_deletion_enabled sync skipped: %', SQLERRM;
END $$;

CREATE INDEX IF NOT EXISTS posts_free_deletion_enabled_idx
  ON public.posts (free_deletion_enabled)
  WHERE free_deletion_enabled = true;

COMMENT ON COLUMN public.posts.free_deletion_enabled IS
  'When true, the verified author may delete this post with no FC / payment. Mirrors deletion_tier=deletable.';

COMMENT ON COLUMN public.posts.owner_token_hash IS
  'SHA-256 hex of a private owner delete token issued at create time. Enables anonymous same-browser delete without trusting IP.';
