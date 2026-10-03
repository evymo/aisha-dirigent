-- Table: wearables_data
-- RLS: ENABLED

CREATE TABLE IF NOT EXISTS wearables_data (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  device_type text NOT NULL,
  data_type text ,
  recorded_at timestamptz NOT NULL,
  value numeric(10,4),
  unit text,
  metadata jsonb,
  created_at timestamptz DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT wearables_data_user_id_fkey FOREIGN KEY (user_id) REFERENCES aisha_auth.users(id) ON DELETE CASCADE
);

ALTER TABLE wearables_data ENABLE ROW LEVEL SECURITY;

-- Grants: user-owned wearables data
GRANT SELECT, INSERT, UPDATE ON wearables_data TO authenticated;
GRANT ALL ON wearables_data TO service_role;
