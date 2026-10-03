-- Table: user_wallets
-- Per-user token balances used for voucher purchases and wallet UI.

CREATE TABLE IF NOT EXISTS user_wallets (
  user_id uuid NOT NULL,
  governance_tokens numeric(20,8) NOT NULL DEFAULT 0,
  impact_tokens numeric(20,8) NOT NULL DEFAULT 0,
  data_tokens numeric(20,8) NOT NULL DEFAULT 0,
  aisha_tokens numeric(20,8) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id),
  CONSTRAINT user_wallets_user_id_fkey FOREIGN KEY (user_id) REFERENCES aisha_auth.users(id) ON DELETE CASCADE
);

ALTER TABLE user_wallets ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON user_wallets TO authenticated;
GRANT ALL ON user_wallets TO service_role;
