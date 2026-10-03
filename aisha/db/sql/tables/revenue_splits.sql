-- Table: revenue_splits
-- Individual revenue split entries per recipient (specialist, knowledge contributor, platform).
-- RLS: ENABLED

CREATE TABLE IF NOT EXISTS revenue_splits (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  project_revenue_id uuid NOT NULL,
  recipient_type split_recipient_type NOT NULL,
  recipient_id uuid,
  percentage numeric(5,2) NOT NULL,
  amount numeric(10,2) NOT NULL,
  currency text,
  attribution_details jsonb,
  payout_status payout_status NOT NULL DEFAULT 'pending',
  stripe_transfer_id text,
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT revenue_splits_project_revenue_id_fkey FOREIGN KEY (project_revenue_id)
    REFERENCES project_revenue(id) ON DELETE CASCADE,
  CONSTRAINT revenue_splits_recipient_id_fkey FOREIGN KEY (recipient_id)
    REFERENCES aisha_auth.users(id) ON DELETE SET NULL,
  CONSTRAINT revenue_splits_percentage_range CHECK (percentage >= 0 AND percentage <= 100),
  CONSTRAINT revenue_splits_amount_non_negative CHECK (amount >= 0)
);

ALTER TABLE revenue_splits ENABLE ROW LEVEL SECURITY;

