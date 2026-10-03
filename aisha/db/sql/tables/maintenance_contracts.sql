-- Table: maintenance_contracts
-- Ongoing maintenance/subscription contracts between members and specialists.
-- RLS: ENABLED

CREATE TABLE IF NOT EXISTS maintenance_contracts (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  story_id uuid NOT NULL,
  member_id uuid NOT NULL,
  specialist_id uuid NOT NULL,
  scope_description text NOT NULL,
  monthly_price numeric(10,2) NOT NULL,
  currency text,
  aisha_autonomy_level text NOT NULL DEFAULT 'supervised',
  escalation_rules jsonb,
  status text NOT NULL DEFAULT 'active',
  stripe_subscription_id text,
  next_billing_date date,
  started_at timestamptz NOT NULL DEFAULT now(),
  paused_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT maintenance_contracts_story_id_fkey FOREIGN KEY (story_id)
    REFERENCES partner_stories(id) ON DELETE CASCADE,
  CONSTRAINT maintenance_contracts_member_id_fkey FOREIGN KEY (member_id)
    REFERENCES aisha_auth.users(id) ON DELETE CASCADE,
  CONSTRAINT maintenance_contracts_specialist_id_fkey FOREIGN KEY (specialist_id)
    REFERENCES partner_profiles(id) ON DELETE CASCADE,
  CONSTRAINT maintenance_contracts_price_positive CHECK (monthly_price > 0),
  CONSTRAINT maintenance_contracts_autonomy_check
    CHECK (aisha_autonomy_level IN ('full', 'supervised', 'manual')),
  CONSTRAINT maintenance_contracts_status_check
    CHECK (status IN ('active', 'paused', 'cancelled'))
);

ALTER TABLE maintenance_contracts ENABLE ROW LEVEL SECURITY;

