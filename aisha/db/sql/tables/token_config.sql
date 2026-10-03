-- Table: token_config
-- RLS: ENABLED

CREATE TABLE IF NOT EXISTS token_config (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  token_name text,
  token_symbol text,
  total_supply numeric(20,8),
  circulating_supply numeric(20,8),
  decimals int4 DEFAULT 8,
  is_active bool DEFAULT true,
  created_at timestamptz DEFAULT now(),
  token_type text NOT NULL,
  name text NOT NULL,
  symbol text NOT NULL,
  description text,
  locked_supply numeric DEFAULT 0,
  burned_supply numeric DEFAULT 0,
  emission_rate_daily numeric DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);

ALTER TABLE token_config ENABLE ROW LEVEL SECURITY;
