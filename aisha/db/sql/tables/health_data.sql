-- Table: health_data
-- RLS: ENABLED

CREATE TABLE IF NOT EXISTS health_data (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  data_type text NOT NULL,
  value numeric NOT NULL,
  unit text NOT NULL,
  metadata jsonb DEFAULT '{}'::jsonb,
  recorded_at timestamptz NOT NULL,
  source text DEFAULT 'manual'::text,
  created_at timestamptz DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT health_data_user_id_data_type_recorded_at_key UNIQUE (recorded_at, data_type, user_id),
  CONSTRAINT health_data_user_id_fkey FOREIGN KEY (user_id) REFERENCES aisha_auth.users(id) ON DELETE CASCADE
);

ALTER TABLE health_data ENABLE ROW LEVEL SECURITY;
