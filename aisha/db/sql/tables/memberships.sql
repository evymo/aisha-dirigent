-- Table: memberships
-- RLS: ENABLED

CREATE TABLE IF NOT EXISTS memberships (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  tier membership_tier NOT NULL DEFAULT 'basic'::membership_tier,
  status membership_status DEFAULT 'active'::membership_status,
  payment_type payment_type,
  subscription_period subscription_period,
  stripe_subscription_id text,
  stripe_customer_id text,
  starts_at timestamptz DEFAULT now(),
  expires_at timestamptz,
  auto_renew bool DEFAULT false,
  tokens_governance int4 DEFAULT 0,
  tokens_impact int4 DEFAULT 0,
  tokens_data int4 DEFAULT 0,
  tokens_aisha int4 NOT NULL DEFAULT 0,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT memberships_user_id_key UNIQUE (user_id),
  CONSTRAINT memberships_user_id_fkey FOREIGN KEY (user_id) REFERENCES aisha_auth.users(id) ON DELETE CASCADE
);

ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;

-- Grants: user-owned membership data
GRANT SELECT, INSERT, UPDATE ON memberships TO authenticated;
GRANT ALL ON memberships TO service_role;
