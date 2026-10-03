-- Table: currency_rates
-- RLS: ENABLED

CREATE TABLE IF NOT EXISTS currency_rates (
  code text NOT NULL,
  name_key text,
  name_native text NOT NULL,
  symbol text NOT NULL DEFAULT ''::text,
  rate_to_base numeric NOT NULL DEFAULT 1,
  is_base bool NOT NULL DEFAULT false,
  is_active bool NOT NULL DEFAULT true,
  sort_order int4 NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  PRIMARY KEY (code),
  CONSTRAINT currency_rates_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES aisha_auth.users(id)
);

ALTER TABLE currency_rates ENABLE ROW LEVEL SECURITY;
