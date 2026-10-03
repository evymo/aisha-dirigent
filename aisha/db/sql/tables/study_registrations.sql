-- Table: study_registrations
-- RLS: ENABLED

CREATE TABLE IF NOT EXISTS study_registrations (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  study_id uuid NOT NULL,
  user_id uuid NOT NULL,
  status text DEFAULT 'pending'::text,
  enrolled_at timestamptz DEFAULT now(),
  completed_at timestamptz,
  dropout_reason text,
  arm text,
  is_placebo bool,
  group_assignment text,
  withdrawn_at timestamptz,
  withdrawal_reason text,
  baseline_data jsonb,
  notes text,
  member_token uuid,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  consultant_id uuid,
  PRIMARY KEY (id),
  CONSTRAINT study_registrations_study_id_user_id_key UNIQUE (user_id, study_id),
  CONSTRAINT study_registrations_consultant_id_fkey FOREIGN KEY (consultant_id) REFERENCES aisha_auth.users(id),
  CONSTRAINT study_registrations_study_id_fkey FOREIGN KEY (study_id) REFERENCES studies(id) ON DELETE CASCADE,
  CONSTRAINT study_registrations_user_id_fkey FOREIGN KEY (user_id) REFERENCES aisha_auth.users(id) ON DELETE CASCADE
);

ALTER TABLE study_registrations ENABLE ROW LEVEL SECURITY;

-- Grants: user-owned registration data
GRANT SELECT, INSERT, UPDATE ON study_registrations TO authenticated;
GRANT ALL ON study_registrations TO service_role;
