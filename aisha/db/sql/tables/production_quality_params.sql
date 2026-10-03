-- Table: production_quality_params
-- Quality control parameters (CPP = Critical Process Parameters, CQA = Critical Quality Attributes)
-- Maps to ERP batch_quality from storm-source-of-truth.md §6.4
-- RLS: ENABLED

CREATE TABLE IF NOT EXISTS production_quality_params (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL,
  step_seq integer,
  parameter text NOT NULL,
  value numeric(16,6),
  value_text text,
  uom text,
  limit_low numeric(16,6),
  limit_high numeric(16,6),
  method text,
  result text DEFAULT 'pending',
  measured_at timestamptz DEFAULT now(),
  measured_by uuid,
  notes text,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT production_quality_params_batch_fkey FOREIGN KEY (batch_id) REFERENCES production_batches(id) ON DELETE CASCADE,
  CONSTRAINT production_quality_params_result_check CHECK (
    result IN ('pending', 'pass', 'fail', 'oob', 'retest')
  ),
  CONSTRAINT production_quality_params_measured_by_fkey FOREIGN KEY (measured_by) REFERENCES aisha_auth.users(id)
);

ALTER TABLE production_quality_params ENABLE ROW LEVEL SECURITY;

-- Grants: admin-managed, read for authenticated
GRANT SELECT ON production_quality_params TO authenticated;
GRANT ALL ON production_quality_params TO service_role;

-- Indexes

-- Column documentation
COMMENT ON TABLE production_quality_params IS 'QC parameter measurements per batch/step. Tracks CPP (Critical Process Parameters) and CQA (Critical Quality Attributes).';
COMMENT ON COLUMN production_quality_params.parameter IS 'Parameter name: LOD, concentration_mg_ml, pH, ethanol_pct, moisture_pct, etc.';
COMMENT ON COLUMN production_quality_params.value IS 'Numeric measurement value';
COMMENT ON COLUMN production_quality_params.value_text IS 'Text value for non-numeric parameters (e.g. color, appearance)';
COMMENT ON COLUMN production_quality_params.limit_low IS 'Lower spec limit (NULL = no lower limit)';
COMMENT ON COLUMN production_quality_params.limit_high IS 'Upper spec limit (NULL = no upper limit)';
COMMENT ON COLUMN production_quality_params.method IS 'Measurement method: gravimetric, volumetric, HPLC, UV-Vis, visual';
COMMENT ON COLUMN production_quality_params.result IS 'Result status: pending, pass, fail, oob (out of bounds), retest';
