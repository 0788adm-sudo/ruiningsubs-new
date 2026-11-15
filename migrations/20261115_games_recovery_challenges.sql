-- Games system reform: 24h free-use recovery cycles, challenge evidence,
-- extend rewards. Compatible with existing data. Runtime primary path remains
-- CF notifs boards; these tables are an optional Supabase mirror.
-- Does NOT modify payment / likes / comments tables.

-- Free-use events (3 per game → recovery_ends_at after 3rd in cycle)
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

ALTER TABLE public.game_free_uses
  ADD COLUMN IF NOT EXISTS cycle boolean DEFAULT true;

-- Play history
CREATE TABLE IF NOT EXISTS public.game_plays (
  id text PRIMARY KEY,
  username text NOT NULL,
  game text NOT NULL CHECK (game IN ('roulette','dice','tic_tac_toe')),
  play_id text NOT NULL,
  paid boolean NOT NULL DEFAULT false,
  free boolean NOT NULL DEFAULT false,
  result_idx integer,
  result jsonb,
  dice jsonb,
  session_id text,
  xp_awarded integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (username, game, play_id)
);
CREATE INDEX IF NOT EXISTS game_plays_user_game_idx
  ON public.game_plays (username, game, created_at DESC);

-- Defeat / game challenges + verification
CREATE TABLE IF NOT EXISTS public.game_challenges (
  id text PRIMARY KEY,
  username text NOT NULL,
  game text NOT NULL CHECK (game IN ('roulette','dice','tic_tac_toe')),
  session_id text,
  challenge_id text NOT NULL,
  proof_type text NOT NULL DEFAULT 'photo'
    CHECK (proof_type IN ('text','photo','video')),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','accepted','submitted','approved','rejected')),
  permanent boolean NOT NULL DEFAULT false,
  free_delete boolean NOT NULL DEFAULT false,
  evidence_post_id text,
  xp_awarded integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS game_challenges_user_status_idx
  ON public.game_challenges (username, status, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS game_challenges_evidence_once_idx
  ON public.game_challenges (username, challenge_id, evidence_post_id)
  WHERE evidence_post_id IS NOT NULL;

-- Win rewards: pin + extend +10d
CREATE TABLE IF NOT EXISTS public.game_rewards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username text NOT NULL,
  game text NOT NULL,
  play_id text,
  post_id text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('pin','extend_10d')),
  featured_until timestamptz,
  expires_at timestamptz,
  granted boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (username, post_id, kind, play_id)
);
CREATE INDEX IF NOT EXISTS game_rewards_post_idx
  ON public.game_rewards (post_id, kind);

-- XP ledger (internal experience only — no FC conversion)
CREATE TABLE IF NOT EXISTS public.game_xp_events (
  id text PRIMARY KEY,
  username text NOT NULL,
  action text NOT NULL,
  amount integer NOT NULL,
  game text,
  ref_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (username, action, ref_id)
);
CREATE INDEX IF NOT EXISTS game_xp_events_user_idx
  ON public.game_xp_events (username, created_at DESC);

COMMENT ON TABLE public.game_challenges IS
  'Game defeat challenges with verification states. XP only on approved.';
COMMENT ON TABLE public.game_rewards IS
  'Verifiable pin / +10d extend rewards from games.';
