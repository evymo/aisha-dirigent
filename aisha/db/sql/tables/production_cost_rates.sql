-- Table: production_cost_rates
-- Temporally-versioned cost rates (energy prices, labor rates)
-- Maps to ERP md_cost_rate from storm-source-of-truth.md §6.2
-- RLS: ENABLED

-- Required extension for EXCLUDE USING gist constraint with non-GiST types
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE IF NOT EXISTS production_cost_rates (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  cost_element_code text NOT NULL,
  cost_element_name text NOT NULL,
  cost_group text NOT NULL DEFAULT 'PRIMARY',
  rate numeric(14,4) NOT NULL,
  uom text NOT NULL,
  valid_from date NOT NULL,
  valid_to date,
  is_active boolean DEFAULT true NOT NULL,
  notes text,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now(),
  created_by uuid,
  PRIMARY KEY (id),
  CONSTRAINT production_cost_rates_no_overlap EXCLUDE USING gist (
    cost_element_code WITH =,
    daterange(valid_from, COALESCE(valid_to, '9999-12-31'::date)) WITH &&
  ),
  CONSTRAINT production_cost_rates_group_check CHECK (
    cost_group IN ('PRIMARY', 'SECONDARY', 'OVERHEAD')
  ),
  CONSTRAINT production_cost_rates_valid_range CHECK (
    valid_to IS NULL OR valid_to >= valid_from
  ),
  CONSTRAINT production_cost_rates_created_by_fkey FOREIGN KEY (created_by) REFERENCES aisha_auth.users(id)
);

ALTER TABLE production_cost_rates ENABLE ROW LEVEL SECURITY;

-- Grants: admin-managed, read for authenticated
GRANT SELECT ON production_cost_rates TO authenticated;
GRANT ALL ON production_cost_rates TO service_role;

-- Column documentation
COMMENT ON TABLE production_cost_rates IS 'Temporally-versioned cost rates. Energy prices change seasonally (11.55 vs 12.29 CZK/kWh). ERP md_cost_rate equivalent.';
COMMENT ON COLUMN production_cost_rates.cost_element_code IS 'Rate identifier: ENERGY_WINTER, ENERGY_SUMMER, LABOR_HOUR, etc.';
COMMENT ON COLUMN production_cost_rates.cost_group IS 'Grouping: PRIMARY (direct), SECONDARY (indirect), OVERHEAD';
COMMENT ON COLUMN production_cost_rates.rate IS 'Numeric rate value';
COMMENT ON COLUMN production_cost_rates.uom IS 'Rate unit: CZK/kWh, CZK/hour, CZK/kg';
COMMENT ON COLUMN production_cost_rates.valid_from IS 'Start of validity period';
COMMENT ON COLUMN production_cost_rates.valid_to IS 'End of validity period (NULL = still valid)';
