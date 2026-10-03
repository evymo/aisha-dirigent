-- Table: production_cost_scenarios
-- Cost scenario definitions (BASE vs TARGET/optimized)
-- Maps to storm-source-of-truth.md §5.1
-- RLS: ENABLED

CREATE TABLE IF NOT EXISTS production_cost_scenarios (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  scenario_code text NOT NULL,
  scenario_name text NOT NULL,
  description text,
  output_qty_mg numeric(16,4),
  output_qty_g numeric(16,4) GENERATED ALWAYS AS (output_qty_mg / 1000.0) STORED,
  is_default boolean DEFAULT false NOT NULL,
  is_active boolean DEFAULT true NOT NULL,
  adjustments jsonb DEFAULT '{}'::jsonb,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now(),
  created_by uuid,
  PRIMARY KEY (id),
  CONSTRAINT production_cost_scenarios_code_key UNIQUE (scenario_code),
  CONSTRAINT production_cost_scenarios_created_by_fkey FOREIGN KEY (created_by) REFERENCES aisha_auth.users(id)
);

ALTER TABLE production_cost_scenarios ENABLE ROW LEVEL SECURITY;

-- Grants: admin-managed, read for authenticated
GRANT SELECT ON production_cost_scenarios TO authenticated;
GRANT ALL ON production_cost_scenarios TO service_role;

-- Column documentation
COMMENT ON TABLE production_cost_scenarios IS 'Cost scenario definitions. BASE = current costs, TARGET = optimized. Each scenario has an output basis quantity.';
COMMENT ON COLUMN production_cost_scenarios.scenario_code IS 'Unique code: BASE, TARGET, etc.';
COMMENT ON COLUMN production_cost_scenarios.output_qty_mg IS 'Output basis in mg for unit cost calculations (e.g. 1028125 mg = 1028.125 g sušiny)';
COMMENT ON COLUMN production_cost_scenarios.output_qty_g IS 'Auto-calculated: output_qty_mg / 1000';
COMMENT ON COLUMN production_cost_scenarios.adjustments IS 'JSONB of per-bucket adjustment factors, e.g. {"LABOR": -0.60, "OVERHEAD": -0.70, "EQUIP": 0.30}';
