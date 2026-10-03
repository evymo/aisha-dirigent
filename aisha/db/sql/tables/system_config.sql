-- Table: system_config
-- RLS: ENABLED

CREATE TABLE IF NOT EXISTS system_config (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  key text NOT NULL,
  value jsonb NOT NULL,
  description text,
  category text NOT NULL DEFAULT 'general'::text,
  is_public boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  PRIMARY KEY (id),
  CONSTRAINT system_config_key_key UNIQUE (key),
  CONSTRAINT system_config_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES aisha_auth.users(id)
);

ALTER TABLE system_config ENABLE ROW LEVEL SECURITY;
