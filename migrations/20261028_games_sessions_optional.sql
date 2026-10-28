-- OPTIONAL game session log for future Worker/RPC persistence.
-- Runtime today uses localStorage rs_game_sessions + CF notifs __GAME_RESULTS__.
-- Do not run against payment tables. Enable RLS before public exposure.

CREATE TABLE IF NOT EXISTS public.game_sessions (
  id text PRIMARY KEY,
  username text NOT NULL,
  opponent text DEFAULT '',
  game_id text NOT NULL,
  mode text NOT NULL,
  result text NOT NULL CHECK (result IN ('win','loss','draw')),
  xp_awarded integer NOT NULL DEFAULT 0 CHECK (xp_awarded >= 0 AND xp_awarded <= 200),
  payload jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (username, game_id, id)
);
CREATE INDEX IF NOT EXISTS game_sessions_user_idx
  ON public.game_sessions (username, created_at DESC);
