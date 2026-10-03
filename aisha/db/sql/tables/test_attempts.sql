-- Table: test_attempts
-- RLS: ENABLED

CREATE TABLE IF NOT EXISTS test_attempts (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  template_id uuid NOT NULL,
  started_at timestamptz DEFAULT now(),
  completed_at timestamptz,
  score int4,
  passed bool,
  answers jsonb,
  created_at timestamptz DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT test_attempts_template_id_fkey FOREIGN KEY (template_id) REFERENCES test_templates(id) ON DELETE CASCADE,
  CONSTRAINT test_attempts_user_id_fkey FOREIGN KEY (user_id) REFERENCES aisha_auth.users(id) ON DELETE CASCADE
);

ALTER TABLE test_attempts ENABLE ROW LEVEL SECURITY;
