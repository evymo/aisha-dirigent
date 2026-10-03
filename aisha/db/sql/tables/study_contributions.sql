-- Table: study_contributions
-- RLS: ENABLED

CREATE TABLE IF NOT EXISTS study_contributions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  study_id uuid NOT NULL,
  user_id uuid NOT NULL,
  contribution_type contribution_type_enum NOT NULL,
  amount numeric(10,2) NOT NULL DEFAULT 0,
  description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  is_anonymous bool NOT NULL DEFAULT false,
  currency text,
  token_type text,
  message text,
  status contribution_status_enum NOT NULL DEFAULT 'pending'::contribution_status_enum,
  updated_at timestamptz NOT NULL DEFAULT now(),
  stripe_payment_intent_id text,
  PRIMARY KEY (id),
  CONSTRAINT study_contributions_study_id_fkey FOREIGN KEY (study_id) REFERENCES studies(id) ON DELETE CASCADE,
  CONSTRAINT study_contributions_user_id_fkey FOREIGN KEY (user_id) REFERENCES aisha_auth.users(id) ON DELETE CASCADE
);

ALTER TABLE study_contributions ENABLE ROW LEVEL SECURITY;
