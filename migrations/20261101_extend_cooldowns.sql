-- Optional: durable Extend cooldown table (user + post + action).
-- Live enforcement currently uses the CF notifs board (__EXTEND_COOLDOWN__)
-- via /api/extend so it works without a Worker redeploy.
-- Apply this migration in Supabase if you want a first-class table later.

CREATE TABLE IF NOT EXISTS public.extend_cooldowns (
  user_id text NOT NULL,
  post_id text NOT NULL,
  action_type text NOT NULL DEFAULT 'extend',
  last_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, post_id, action_type)
);

CREATE INDEX IF NOT EXISTS extend_cooldowns_last_at_idx
  ON public.extend_cooldowns (last_at DESC);

COMMENT ON TABLE public.extend_cooldowns IS
  'Hourly Extend cooldown keyed by user_id + post_id + action_type';
