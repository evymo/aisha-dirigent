-- Table: study_blinding_config
-- RLS: ENABLED

CREATE TABLE IF NOT EXISTS study_blinding_config (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  study_id uuid NOT NULL,
  arm_name text,
  is_placebo bool DEFAULT false,
  percentage int4 DEFAULT 50,
  is_blinded bool,
  blinding_type text,
  group_definitions jsonb,
  unblinded_at timestamptz,
  unblinded_by uuid,
  unblinding_reason text,
  placebo_compensation_enabled bool,
  compensation_protocol text,
  created_at timestamptz,
  updated_at timestamptz,
  PRIMARY KEY (id),
  CONSTRAINT study_blinding_config_study_id_arm_name_key UNIQUE (arm_name, study_id),
  CONSTRAINT study_blinding_config_study_id_fkey FOREIGN KEY (study_id) REFERENCES studies(id) ON DELETE CASCADE
);

ALTER TABLE study_blinding_config ENABLE ROW LEVEL SECURITY;
