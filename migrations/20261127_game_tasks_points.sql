-- Game task catalog + points economy (independent of Coins).
-- Runtime primary path: CF notification boards via api/game-tasks.js.
-- These tables are an optional Supabase mirror for admin / future Worker sync.
-- Does NOT modify coin_* payment tables, Wall, Feed, or auth.

-- Expandable challenge catalog (hundreds of rows OK)
CREATE TABLE IF NOT EXISTS public.game_task_catalog (
  id text PRIMARY KEY,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  requirements text NOT NULL DEFAULT '',
  game text NOT NULL CHECK (game IN ('roulette','dice','tic_tac_toe','all')),
  category text NOT NULL DEFAULT 'general',
  difficulty text NOT NULL DEFAULT 'easy'
    CHECK (difficulty IN ('easy','medium','hard','extreme')),
  points integer NOT NULL DEFAULT 10 CHECK (points >= 0 AND points <= 10000),
  proof_type text NOT NULL DEFAULT 'photo'
    CHECK (proof_type IN ('photo','video','link','wall_post','admin_verify')),
  validation_rules jsonb NOT NULL DEFAULT '{}'::jsonb,
  active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 100,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS game_task_catalog_game_active_idx
  ON public.game_task_catalog (game, active, sort_order);

-- Per-user task progress (user picks freely — never auto-assigned)
CREATE TABLE IF NOT EXISTS public.game_task_progress (
  id text PRIMARY KEY,
  username text NOT NULL,
  task_id text NOT NULL REFERENCES public.game_task_catalog(id),
  game text NOT NULL,
  status text NOT NULL DEFAULT 'available'
    CHECK (status IN ('available','in_progress','pending_review','completed','rejected')),
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  evidence_post_id text,
  points_awarded integer NOT NULL DEFAULT 0,
  reviewer text,
  review_note text,
  selected_at timestamptz,
  submitted_at timestamptz,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (username, task_id)
);
CREATE INDEX IF NOT EXISTS game_task_progress_user_status_idx
  ON public.game_task_progress (username, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS game_task_progress_pending_idx
  ON public.game_task_progress (status, submitted_at DESC)
  WHERE status = 'pending_review';

-- Points ledger (NOT Coins — separate economy). Idempotent by (username, action, ref_id).
CREATE TABLE IF NOT EXISTS public.game_points_ledger (
  id text PRIMARY KEY,
  username text NOT NULL,
  action text NOT NULL,
  amount integer NOT NULL,
  balance_after integer,
  task_id text,
  ref_id text NOT NULL,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (username, action, ref_id)
);
CREATE INDEX IF NOT EXISTS game_points_ledger_user_idx
  ON public.game_points_ledger (username, created_at DESC);

-- Future public-exposure rewards (DISABLED by default — do not enable in prod yet)
CREATE TABLE IF NOT EXISTS public.game_reward_defs (
  id text PRIMARY KEY,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  points_cost integer NOT NULL DEFAULT 0 CHECK (points_cost >= 0),
  kind text NOT NULL DEFAULT 'exposure'
    CHECK (kind IN ('exposure','recording','visibility','other')),
  enabled boolean NOT NULL DEFAULT false,
  published boolean NOT NULL DEFAULT false,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.game_reward_redemptions (
  id text PRIMARY KEY,
  username text NOT NULL,
  reward_id text NOT NULL REFERENCES public.game_reward_defs(id),
  points_spent integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'blocked'
    CHECK (status IN ('blocked','pending','approved','rejected','fulfilled')),
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.game_task_catalog IS
  'Configurable game challenges. Points awarded only after approved proof.';
COMMENT ON TABLE public.game_points_ledger IS
  'Task points economy — independent of Coins wallet.';
COMMENT ON TABLE public.game_reward_defs IS
  'Future exposure rewards. Keep enabled=false and published=false until business-ready.';
