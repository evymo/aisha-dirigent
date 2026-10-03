-- Table: token_transactions
-- RLS: ENABLED

CREATE TABLE IF NOT EXISTS token_transactions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  from_user_id uuid,
  to_user_id uuid,
  amount numeric(20,8),
  transaction_type text,
  reference_type text,
  reference_id uuid,
  description text,
  metadata jsonb,
  created_at timestamptz DEFAULT now(),
  user_id uuid,
  token_type text,
  balance_after numeric(20,8),
  PRIMARY KEY (id),
  CONSTRAINT token_transactions_from_user_id_fkey FOREIGN KEY (from_user_id) REFERENCES aisha_auth.users(id) ON DELETE SET NULL,
  CONSTRAINT token_transactions_to_user_id_fkey FOREIGN KEY (to_user_id) REFERENCES aisha_auth.users(id) ON DELETE SET NULL,
  CONSTRAINT token_transactions_user_id_fkey FOREIGN KEY (user_id) REFERENCES aisha_auth.users(id)
);

ALTER TABLE token_transactions ENABLE ROW LEVEL SECURITY;
