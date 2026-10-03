-- Table: subscription_packages
-- RLS: ENABLED

CREATE TABLE IF NOT EXISTS subscription_packages (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL,
  description text,
  tier membership_tier NOT NULL DEFAULT 'basic'::membership_tier,
  period subscription_period NOT NULL DEFAULT 'monthly'::subscription_period,
  is_recurring bool DEFAULT true,
  stripe_price_id text,
  includes_products text[],
  includes_diagnostics text[],
  governance_tokens int4 DEFAULT 0,
  impact_tokens int4 DEFAULT 0,
  is_active bool DEFAULT true,
  sort_order int4 DEFAULT 0,
  features jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  price numeric NOT NULL DEFAULT 0,
  currency text,
  tokens_governance int4 NOT NULL DEFAULT 0,
  tokens_impact int4 NOT NULL DEFAULT 0,
  tokens_data int4 NOT NULL DEFAULT 0,
  allow_one_time_payment bool NOT NULL DEFAULT false,
  allow_recurring_payment bool NOT NULL DEFAULT false,
  billing_interval_months int4,
  min_billing_months int4 NOT NULL DEFAULT 1,
  stripe_product_id text,
  stripe_price_id_one_time text,
  stripe_price_id_recurring text,
  name_key text,
  description_key text,
  PRIMARY KEY (id),
  CONSTRAINT subscription_packages_slug_key UNIQUE (slug)
);

ALTER TABLE subscription_packages ENABLE ROW LEVEL SECURITY;
