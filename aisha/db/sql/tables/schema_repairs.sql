-- Table: schema_repairs
-- RLS: ENABLED

CREATE TABLE IF NOT EXISTS schema_repairs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  repair_type text NOT NULL,
  description text,
  sql_executed text,
  success bool DEFAULT true,
  error_message text,
  repaired_at timestamptz DEFAULT now(),
  PRIMARY KEY (id)
);

ALTER TABLE schema_repairs ENABLE ROW LEVEL SECURITY;
