-- Table: production_qc_test_definitions
-- Formalized QC test specifications with method, limits, and sampling plan
-- Maps to erp-basis.md: QC test definition entity (test_code, spec_limits, method_ref, sampling_plan)
-- Provides the "what to test" master data that production_quality_params references
-- RLS: ENABLED

CREATE TABLE IF NOT EXISTS production_qc_test_definitions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  test_code text NOT NULL,
  test_name text NOT NULL,
  method_ref text,
  description text,
  units text,
  spec_limit_low numeric(16,6),
  spec_limit_high numeric(16,6),
  target_value numeric(16,6),
  sampling_plan jsonb,
  applicable_products text[],
  applicable_steps text[],
  frequency text DEFAULT 'per_batch' NOT NULL,
  version text DEFAULT '1.0' NOT NULL,
  is_active boolean DEFAULT true NOT NULL,
  notes text,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now(),
  created_by uuid,
  PRIMARY KEY (id),
  CONSTRAINT production_qc_test_definitions_code_version_key UNIQUE (test_code, version),
  CONSTRAINT production_qc_test_definitions_frequency_check CHECK (
    frequency IN ('per_batch', 'per_step', 'periodic', 'on_demand', 'skip_lot', 'annual')
  ),
  CONSTRAINT production_qc_test_definitions_created_by_fkey FOREIGN KEY (created_by) REFERENCES aisha_auth.users(id)
);

ALTER TABLE production_qc_test_definitions ENABLE ROW LEVEL SECURITY;

-- Grants: admin-managed, read for authenticated
GRANT SELECT ON production_qc_test_definitions TO authenticated;
GRANT ALL ON production_qc_test_definitions TO service_role;

-- Indexes

-- Column documentation
COMMENT ON TABLE production_qc_test_definitions IS 'QC test specification master data. Per erp-basis.md: defines what to test, how, and acceptance criteria. Versioned for change control.';
COMMENT ON COLUMN production_qc_test_definitions.test_code IS 'Unique test code, e.g. QC-LOD, QC-CONC, QC-PH, QC-ETHANOL, QC-MOISTURE';
COMMENT ON COLUMN production_qc_test_definitions.method_ref IS 'Reference to analytical method: gravimetric, HPLC, UV-Vis, titration, Karl-Fischer, etc.';
COMMENT ON COLUMN production_qc_test_definitions.spec_limit_low IS 'Lower specification limit (NULL = no lower limit)';
COMMENT ON COLUMN production_qc_test_definitions.spec_limit_high IS 'Upper specification limit (NULL = no upper limit)';
COMMENT ON COLUMN production_qc_test_definitions.target_value IS 'Target/nominal value for the measurement';
COMMENT ON COLUMN production_qc_test_definitions.sampling_plan IS 'JSONB: {type, sample_size, acceptance_number, frequency_hours}';
COMMENT ON COLUMN production_qc_test_definitions.applicable_products IS 'Array of product names this test applies to: {Retisin, Floristen, Lyastin}';
COMMENT ON COLUMN production_qc_test_definitions.applicable_steps IS 'Array of step codes where test is performed: {DRYING, MACERATION, EXTRACTION}';
COMMENT ON COLUMN production_qc_test_definitions.frequency IS 'Testing frequency: per_batch, per_step, periodic (calendar), on_demand, skip_lot, annual';
COMMENT ON COLUMN production_qc_test_definitions.version IS 'Spec version for change control. New version = new record (old deactivated).';
