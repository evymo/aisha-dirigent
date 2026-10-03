-- Table: growth_policy_parameters
-- RLS: ENABLED

CREATE TABLE IF NOT EXISTS growth_policy_parameters (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  parameter_name text ,
  parameter_value jsonb ,
  description text,
  is_active bool DEFAULT true,
  created_at timestamptz DEFAULT now(),
  policy_name text,
  policy_category text,
  current_value numeric,
  min_value numeric,
  max_value numeric,
  unit text,
  auto_adjust_enabled bool,
  adjustment_rules jsonb,
  last_adjusted_at timestamptz,
  last_adjusted_by uuid,
  adjustment_reason text,
  blockchain_tx_hash text,
  updated_at timestamptz,
  PRIMARY KEY (id),
  CONSTRAINT growth_policy_parameters_parameter_name_key UNIQUE (parameter_name)
);

ALTER TABLE growth_policy_parameters ENABLE ROW LEVEL SECURITY;
