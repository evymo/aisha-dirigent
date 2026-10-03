-- Table: user_distribution_schedule
-- RLS: ENABLED

CREATE TABLE IF NOT EXISTS user_distribution_schedule (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  study_id uuid,
  scheduled_date date NOT NULL,
  status text DEFAULT 'pending'::text,
  vial_count int4 DEFAULT 1,
  shipped_at timestamptz,
  delivered_at timestamptz,
  tracking_number text,
  carrier text,
  created_at timestamptz DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT user_distribution_schedule_study_id_fkey FOREIGN KEY (study_id) REFERENCES studies(id) ON DELETE SET NULL,
  CONSTRAINT user_distribution_schedule_user_id_fkey FOREIGN KEY (user_id) REFERENCES aisha_auth.users(id) ON DELETE CASCADE
);

ALTER TABLE user_distribution_schedule ENABLE ROW LEVEL SECURITY;
