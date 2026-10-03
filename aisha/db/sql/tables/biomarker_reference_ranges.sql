-- Table: biomarker_reference_ranges
-- RLS: ENABLED

CREATE TABLE IF NOT EXISTS biomarker_reference_ranges (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  biomarker_key text NOT NULL,
  unit text NOT NULL,
  min_value numeric,
  max_value numeric,
  optimal_min numeric,
  optimal_max numeric,
  critical_low numeric,
  critical_high numeric,
  category text,
  name_key text,
  description_key text,
  is_active bool DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT biomarker_reference_ranges_biomarker_key_key UNIQUE (biomarker_key)
);

ALTER TABLE biomarker_reference_ranges ENABLE ROW LEVEL SECURITY;
