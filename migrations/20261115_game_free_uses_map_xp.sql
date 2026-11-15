-- Lifetime free game uses + map pin XP durability (optional Supabase mirror).
-- Runtime primary path: CF notifs boards __GAME_FREE_USES__, __PIN_REWARDS__,
-- notifications type=xp_event. Does NOT modify payment tables.

CREATE TABLE IF NOT EXISTS public.game_free_uses (
  id text PRIMARY KEY,
  username text NOT NULL,
  game text NOT NULL CHECK (game IN ('roulette','dice','tic_tac_toe')),
  play_id text NOT NULL,
  anon boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (username, game, play_id)
);
CREATE INDEX IF NOT EXISTS game_free_uses_user_game_idx
  ON public.game_free_uses (username, game, created_at DESC);

CREATE TABLE IF NOT EXISTS public.roulette_pin_rewards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username text NOT NULL,
  post_id text NOT NULL,
  play_id text,
  featured_until timestamptz,
  source text NOT NULL DEFAULT 'roulette',
  invalidated boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS roulette_pin_rewards_post_idx
  ON public.roulette_pin_rewards (post_id, invalidated);

-- map_pin XP is recorded via xp_events / notifications type=xp_event
-- with action=map_pin and forever dedupe (see RS_XP_ACTIONS.map_pin).
