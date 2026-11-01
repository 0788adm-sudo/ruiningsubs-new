-- Optional durability for FC economy / games / HOT / Triki pin rewards.
-- Runtime primary path uses CF wallet + CF notifs boards:
--   __GAME_PLAYS__, __GAME_FREE_DAY__, __TRIKI_SESSIONS__, __PIN_REWARDS__
-- Admin HOT is stored as post tag "admin_hot" (no schema change required).
-- Run only if you want Supabase mirrors. Does NOT modify payment tables.

CREATE TABLE IF NOT EXISTS public.fc_game_plays (
  id text PRIMARY KEY,
  username text NOT NULL,
  game text NOT NULL,
  paid boolean NOT NULL DEFAULT false,
  coins integer NOT NULL DEFAULT 0 CHECK (coins >= 0),
  result jsonb DEFAULT '{}'::jsonb,
  session_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS fc_game_plays_user_idx
  ON public.fc_game_plays (username, created_at DESC);
CREATE INDEX IF NOT EXISTS fc_game_plays_game_idx
  ON public.fc_game_plays (game, created_at DESC);

CREATE TABLE IF NOT EXISTS public.triki_pin_rewards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username text NOT NULL,
  post_id text NOT NULL,
  session_id text,
  wins integer NOT NULL DEFAULT 3,
  featured_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS triki_pin_rewards_user_idx
  ON public.triki_pin_rewards (username, created_at DESC);

-- NOTE: Enable RLS + service-role writes before exposing publicly.
-- Frontend does NOT require these tables to function.
