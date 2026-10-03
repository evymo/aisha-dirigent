-- Table: production_cost_lines
-- Individual cost line items per batch (or scenario template)
-- Maps to ERP batch_cost_line from storm-source-of-truth.md §6.4
-- RLS: ENABLED

CREATE TABLE IF NOT EXISTS production_cost_lines (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  batch_id uuid,
  scenario_id uuid,
  cost_element text NOT NULL,
  bucket_code text,
  amount numeric(14,2) NOT NULL DEFAULT 0,
  currency text,
  basis text,
  source text,
  notes text,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now(),
  created_by uuid,
  PRIMARY KEY (id),
  CONSTRAINT production_cost_lines_batch_fkey FOREIGN KEY (batch_id) REFERENCES production_batches(id) ON DELETE CASCADE,
  -- FK to production_cost_scenarios added via constraints/ (alphabetical ordering: cost_lines < cost_scenarios)
  CONSTRAINT production_cost_lines_cost_element_check CHECK (
    cost_element IN ('LABOR', 'MATERIAL', 'OVERHEAD', 'EQUIP', 'RAW', 'ENERGY')
  ),
  CONSTRAINT production_cost_lines_bucket_check CHECK (
    bucket_code IS NULL OR bucket_code ~ '^B[0-9]{2}$'
  ),
  CONSTRAINT production_cost_lines_has_parent CHECK (
    batch_id IS NOT NULL OR scenario_id IS NOT NULL
  ),
  CONSTRAINT production_cost_lines_created_by_fkey FOREIGN KEY (created_by) REFERENCES aisha_auth.users(id)
);

ALTER TABLE production_cost_lines ENABLE ROW LEVEL SECURITY;

-- Grants: admin-managed
GRANT SELECT ON production_cost_lines TO authenticated;
GRANT ALL ON production_cost_lines TO service_role;

-- Column documentation
COMMENT ON TABLE production_cost_lines IS 'Cost line items. Can belong to a batch (actuals) or scenario (template/planned). ERP batch_cost_line equivalent.';
COMMENT ON COLUMN production_cost_lines.batch_id IS 'Production batch (NULL for scenario template lines)';
COMMENT ON COLUMN production_cost_lines.scenario_id IS 'Cost scenario (NULL for batch-specific actuals)';
COMMENT ON COLUMN production_cost_lines.cost_element IS 'Cost category: LABOR, MATERIAL, OVERHEAD, EQUIP, RAW, ENERGY';
COMMENT ON COLUMN production_cost_lines.bucket_code IS 'Operation bucket B01-B08 (from storm-source-of-truth §5.3)';
COMMENT ON COLUMN production_cost_lines.amount IS 'Amount in CZK';
COMMENT ON COLUMN production_cost_lines.basis IS 'What the amount relates to, e.g. per_batch, per_kg, per_hour';
COMMENT ON COLUMN production_cost_lines.source IS 'Data origin: actual, estimate, calculated, budget';
