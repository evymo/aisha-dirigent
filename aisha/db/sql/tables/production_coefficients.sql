-- Table: production_coefficients
-- Process coefficients, conversion factors, and physical constants used in production calculations
-- Maps to storm-source-of-truth.md §3 (Koeficienty a konverzní faktory)
-- RLS: ENABLED

CREATE TABLE IF NOT EXISTS production_coefficients (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  product text NOT NULL,
  coefficient_name text NOT NULL,
  symbol text,
  value numeric(16,8) NOT NULL,
  unit text,
  definition text,
  source text DEFAULT 'measured',
  confidence text DEFAULT 'measured',
  valid_from date,
  valid_to date,
  is_active boolean DEFAULT true NOT NULL,
  notes text,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now(),
  created_by uuid,
  PRIMARY KEY (id),
  CONSTRAINT production_coefficients_confidence_check CHECK (
    confidence IN ('measured', 'calculated', 'estimated', 'literature', 'validated')
  ),
  CONSTRAINT production_coefficients_source_check CHECK (
    source IN ('measured', 'calculated', 'estimated', 'literature', 'lab_analysis', 'gravimetric', 'volumetric')
  ),
  CONSTRAINT production_coefficients_created_by_fkey FOREIGN KEY (created_by) REFERENCES aisha_auth.users(id)
);

ALTER TABLE production_coefficients ENABLE ROW LEVEL SECURITY;

-- Grants: read for all authenticated, admin-managed
GRANT SELECT ON production_coefficients TO authenticated;
GRANT ALL ON production_coefficients TO service_role;

-- Column documentation
COMMENT ON TABLE production_coefficients IS 'Process coefficients and conversion factors. Temporally versioned (valid_from/to). Source: lab measurements, calculations, literature.';
COMMENT ON COLUMN production_coefficients.product IS 'Product line: Floristen, Retisin, Lyastin, Common';
COMMENT ON COLUMN production_coefficients.coefficient_name IS 'Descriptive name, e.g. k_sesych, k_blood_dry, LOD_avg, eta_extract';
COMMENT ON COLUMN production_coefficients.symbol IS 'Mathematical symbol, e.g. k_sesych, η_dry, LOD';
COMMENT ON COLUMN production_coefficients.value IS 'Numeric value of the coefficient';
COMMENT ON COLUMN production_coefficients.unit IS 'Unit or ratio description, e.g. kg/kg, %, L/kg';
COMMENT ON COLUMN production_coefficients.definition IS 'Human-readable definition, e.g. čerstvá / suchá (22935/6473)';
COMMENT ON COLUMN production_coefficients.source IS 'How determined: measured, calculated, estimated, literature, lab_analysis, gravimetric, volumetric';
COMMENT ON COLUMN production_coefficients.confidence IS 'Reliability: measured (direct), calculated (derived), estimated (approximation), literature, validated';
COMMENT ON COLUMN production_coefficients.valid_from IS 'Start of validity period (NULL = always valid)';
COMMENT ON COLUMN production_coefficients.valid_to IS 'End of validity period (NULL = still valid)';
