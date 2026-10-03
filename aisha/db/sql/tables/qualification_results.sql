-- Table: qualification_results
-- Source of truth (SQL): used for init generation
-- RLS: ENABLED

CREATE TABLE IF NOT EXISTS qualification_results (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  score int4 NOT NULL,
  passed bool NOT NULL DEFAULT false,
  completed_at timestamptz,
  answers jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT qualification_results_user_id_fkey FOREIGN KEY (user_id) REFERENCES aisha_auth.users(id) ON DELETE CASCADE
);

ALTER TABLE qualification_results ENABLE ROW LEVEL SECURITY;
