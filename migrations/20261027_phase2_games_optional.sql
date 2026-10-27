-- OPTIONAL Phase 2 schema for server-side game/XP validation.
-- Ruiningsubs currently awards XP via client grantXp + profiles.xp +
-- notifications type=xp_event (no Worker source in this repo).
-- Run only if you want durable server tables for a future Worker/RPC.
-- Does NOT modify payment tables (coin_*, throne_events, etc.).

-- Append-only XP event log (idempotent by event_id)
CREATE TABLE IF NOT EXISTS public.xp_events (
  event_id text PRIMARY KEY,
  username text NOT NULL,
  action text NOT NULL,
  ref_id text,
  xp integer NOT NULL CHECK (xp >= 0 AND xp <= 500),
  day_key text NOT NULL,
  meta jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS xp_events_user_day_idx ON public.xp_events (username, day_key);
CREATE INDEX IF NOT EXISTS xp_events_created_idx ON public.xp_events (created_at DESC);

-- Game session / score audit (optional)
CREATE TABLE IF NOT EXISTS public.game_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username text NOT NULL,
  game_id text NOT NULL,
  session_token text NOT NULL,
  score integer,
  meta jsonb DEFAULT '{}'::jsonb,
  xp_granted integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (username, session_token)
);
CREATE INDEX IF NOT EXISTS game_sessions_user_game_idx ON public.game_sessions (username, game_id, created_at DESC);

-- NOTE: Enable RLS + service-role writes from Worker before exposing these.
-- Frontend today does NOT require these tables to function.
