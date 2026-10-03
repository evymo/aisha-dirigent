-- Table: control_protocols
-- RLS: ENABLED

CREATE TABLE IF NOT EXISTS control_protocols (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  protocol_type text,
  parameters jsonb,
  is_active bool DEFAULT true,
  created_at timestamptz DEFAULT now(),
  PRIMARY KEY (id)
);

ALTER TABLE control_protocols ENABLE ROW LEVEL SECURITY;
