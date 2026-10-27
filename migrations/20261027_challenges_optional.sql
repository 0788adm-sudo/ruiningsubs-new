-- OPTIONAL Challenges persistence for a future Worker/RPC.
-- Runtime today uses local grantXp ledger + rs_challenges localStorage
-- + notifications type=xp_event. Do not run against payment tables.

CREATE TABLE IF NOT EXISTS public.challenge_completions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username text NOT NULL,
  challenge_id text NOT NULL,
  day_key text NOT NULL,
  xp integer NOT NULL CHECK (xp >= 0 AND xp <= 200),
  status text NOT NULL CHECK (status IN ('completed','pending','rejected')),
  evidence jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (username, challenge_id, day_key)
);
CREATE INDEX IF NOT EXISTS challenge_completions_day_idx
  ON public.challenge_completions (day_key, status);

-- Enable RLS + service role writes before exposing publicly.
