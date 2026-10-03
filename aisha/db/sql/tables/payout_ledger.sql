-- Table: payout_ledger
-- Financial ledger tracking credits/debits per user.
-- RLS: ENABLED

CREATE TABLE IF NOT EXISTS payout_ledger (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  amount numeric(10,2) NOT NULL,
  currency text,
  direction ledger_direction NOT NULL,
  balance_after numeric(10,2) NOT NULL,
  reference_type text NOT NULL,
  reference_id uuid,
  description text,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT payout_ledger_user_id_fkey FOREIGN KEY (user_id)
    REFERENCES aisha_auth.users(id) ON DELETE CASCADE
);

ALTER TABLE payout_ledger ENABLE ROW LEVEL SECURITY;

