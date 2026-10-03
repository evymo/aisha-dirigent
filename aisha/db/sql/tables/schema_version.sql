-- Table: schema_version
-- RLS: ENABLED

CREATE TABLE IF NOT EXISTS schema_version (
  id int4 NOT NULL DEFAULT 1,
  version text NOT NULL DEFAULT '0.0.0'::text,
  baseline_applied_at timestamptz,
  last_repair_at timestamptz,
  last_repair_count int4 DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  PRIMARY KEY (id)
);

ALTER TABLE schema_version ENABLE ROW LEVEL SECURITY;
