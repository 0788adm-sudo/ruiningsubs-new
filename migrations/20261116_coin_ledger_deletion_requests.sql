-- Coin ledger + durable deletion payment requests.
-- Safe to run multiple times. App already writes coin_ledger on FC delete spends;
-- production previously lacked the table (PGRST205), so SB idempotency was a no-op.

CREATE TABLE IF NOT EXISTS public.coin_ledger (
  id bigserial PRIMARY KEY,
  user_id text NOT NULL,
  kind text NOT NULL DEFAULT 'spend',
  action text,
  coins integer NOT NULL DEFAULT 0,
  ref text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS coin_ledger_user_id_idx
  ON public.coin_ledger (user_id, created_at DESC);

-- One spend/refund ref per user → concurrent double-click cannot double-charge.
CREATE UNIQUE INDEX IF NOT EXISTS coin_ledger_user_ref_uidx
  ON public.coin_ledger (user_id, ref)
  WHERE ref IS NOT NULL AND btrim(ref) <> '';

COMMENT ON TABLE public.coin_ledger IS
  'FC wallet ledger (spend/add). Unique (user_id, ref) makes delete/pin spends idempotent.';

-- Durable admin-visible deletion payment claims (PayPal / Throne).
-- Complements Cloudflare /requests which can time out from Vercel.
CREATE TABLE IF NOT EXISTS public.deletion_payment_requests (
  id bigserial PRIMARY KEY,
  request_key text NOT NULL,
  post_id text NOT NULL,
  requester text NOT NULL,
  publisher text DEFAULT '',
  provider text DEFAULT 'paypal/throne',
  amount text DEFAULT '$5',
  status text NOT NULL DEFAULT 'pending',
  message text DEFAULT '',
  thumb_url text DEFAULT '',
  cf_request_id text DEFAULT '',
  payload jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolved_by text DEFAULT ''
);

CREATE UNIQUE INDEX IF NOT EXISTS deletion_payment_requests_key_uidx
  ON public.deletion_payment_requests (request_key);

CREATE INDEX IF NOT EXISTS deletion_payment_requests_status_idx
  ON public.deletion_payment_requests (status, created_at DESC);

CREATE INDEX IF NOT EXISTS deletion_payment_requests_post_idx
  ON public.deletion_payment_requests (post_id, created_at DESC);

COMMENT ON TABLE public.deletion_payment_requests IS
  'Persistent PayPal/Throne delete claims for the admin DELETE REQUESTS panel. status: pending|approved|rejected|cleared.';

-- Anon key already used for notifications inserts; allow same for request rows.
ALTER TABLE public.deletion_payment_requests ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'deletion_payment_requests'
      AND policyname = 'deletion_payment_requests_select_all'
  ) THEN
    CREATE POLICY deletion_payment_requests_select_all
      ON public.deletion_payment_requests FOR SELECT
      USING (true);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'deletion_payment_requests'
      AND policyname = 'deletion_payment_requests_insert_all'
  ) THEN
    CREATE POLICY deletion_payment_requests_insert_all
      ON public.deletion_payment_requests FOR INSERT
      WITH CHECK (true);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'deletion_payment_requests'
      AND policyname = 'deletion_payment_requests_update_all'
  ) THEN
    CREATE POLICY deletion_payment_requests_update_all
      ON public.deletion_payment_requests FOR UPDATE
      USING (true)
      WITH CHECK (true);
  END IF;
EXCEPTION WHEN others THEN
  RAISE NOTICE 'deletion_payment_requests RLS policies skipped: %', SQLERRM;
END $$;

ALTER TABLE public.coin_ledger ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'coin_ledger'
      AND policyname = 'coin_ledger_select_all'
  ) THEN
    CREATE POLICY coin_ledger_select_all
      ON public.coin_ledger FOR SELECT
      USING (true);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'coin_ledger'
      AND policyname = 'coin_ledger_insert_all'
  ) THEN
    CREATE POLICY coin_ledger_insert_all
      ON public.coin_ledger FOR INSERT
      WITH CHECK (true);
  END IF;
EXCEPTION WHEN others THEN
  RAISE NOTICE 'coin_ledger RLS policies skipped: %', SQLERRM;
END $$;
