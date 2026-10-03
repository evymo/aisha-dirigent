-- Table: permissions
-- RLS: ENABLED

CREATE TABLE IF NOT EXISTS permissions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  code text NOT NULL,
  name text NOT NULL,
  description text,
  category text NOT NULL DEFAULT 'general'::text,
  is_system bool NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT permissions_code_key UNIQUE (code)
);

ALTER TABLE permissions ENABLE ROW LEVEL SECURITY;
