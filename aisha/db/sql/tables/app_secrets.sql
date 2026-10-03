-- Table: app_secrets
-- RLS: ENABLED

CREATE TABLE IF NOT EXISTS app_secrets (
  key text NOT NULL,
  value text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  PRIMARY KEY (key)
);

ALTER TABLE app_secrets ENABLE ROW LEVEL SECURITY;
