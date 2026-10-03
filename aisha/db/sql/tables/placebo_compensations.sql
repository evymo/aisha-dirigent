-- Table: placebo_compensations
-- RLS: ENABLED

CREATE TABLE IF NOT EXISTS placebo_compensations (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid ,
  study_id uuid NOT NULL,
  compensation_type text ,
  amount numeric(10,2),
  description text,
  granted_at timestamptz DEFAULT now(),
  claimed_at timestamptz,
  PRIMARY KEY (id),
  CONSTRAINT placebo_compensations_user_id_study_id_compensation_type_key UNIQUE (study_id, compensation_type, user_id),
  CONSTRAINT placebo_compensations_study_id_fkey FOREIGN KEY (study_id) REFERENCES studies(id) ON DELETE CASCADE,
  CONSTRAINT placebo_compensations_user_id_fkey FOREIGN KEY (user_id) REFERENCES aisha_auth.users(id) ON DELETE CASCADE
);

ALTER TABLE placebo_compensations ENABLE ROW LEVEL SECURITY;
