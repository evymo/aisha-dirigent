-- Table: member_subscriptions
-- RLS: ENABLED

CREATE TABLE IF NOT EXISTS member_subscriptions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  package_id uuid NOT NULL,
  status text DEFAULT 'active'::text,
  started_at timestamptz DEFAULT now(),
  ends_at timestamptz,
  stripe_subscription_id text,
  created_at timestamptz DEFAULT now(),
  membership_id uuid,
  period_start timestamptz,
  period_end timestamptz,
  amount_paid numeric,
  currency text,
  stripe_payment_intent_id text,
  stripe_invoice_id text,
  billing_interval_months int4,
  cancel_at_period_end bool DEFAULT false,
  next_billing_date timestamptz,
  payment_type payment_type DEFAULT 'one_time'::payment_type,
  PRIMARY KEY (id),
  CONSTRAINT member_subscriptions_membership_id_fkey FOREIGN KEY (membership_id) REFERENCES memberships(id),
  CONSTRAINT member_subscriptions_package_id_fkey FOREIGN KEY (package_id) REFERENCES subscription_packages(id),
  CONSTRAINT member_subscriptions_user_id_fkey FOREIGN KEY (user_id) REFERENCES aisha_auth.users(id) ON DELETE CASCADE
);

ALTER TABLE member_subscriptions ENABLE ROW LEVEL SECURITY;
