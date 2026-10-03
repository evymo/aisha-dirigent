-- Table: production_resources
-- Equipment and work center registry (machines, labor types)
-- Maps to ERP md_resource from storm-source-of-truth.md §6.2
-- RLS: ENABLED

CREATE TABLE IF NOT EXISTS production_resources (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  resource_code text NOT NULL,
  resource_name text NOT NULL,
  resource_type text NOT NULL DEFAULT 'MACHINE',
  power_kw numeric(8,2),
  location text,
  capacity_info text,
  operating_cost_per_hour numeric(10,2),
  is_active boolean DEFAULT true NOT NULL,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now(),
  created_by uuid,
  PRIMARY KEY (id),
  CONSTRAINT production_resources_code_key UNIQUE (resource_code),
  CONSTRAINT production_resources_type_check CHECK (
    resource_type IN ('MACHINE', 'LABOR', 'INSTRUMENT', 'FACILITY')
  ),
  CONSTRAINT production_resources_created_by_fkey FOREIGN KEY (created_by) REFERENCES aisha_auth.users(id)
);

ALTER TABLE production_resources ENABLE ROW LEVEL SECURITY;

-- Grants: read for authenticated, admin-managed
GRANT SELECT ON production_resources TO authenticated;
GRANT ALL ON production_resources TO service_role;

-- Column documentation
COMMENT ON TABLE production_resources IS 'Equipment and work center registry. ERP md_resource equivalent. Tracks machines, labor types, instruments.';
COMMENT ON COLUMN production_resources.resource_code IS 'Unique code, e.g. WC-DRY-01, WC-SOX-1L, WC-LABOR';
COMMENT ON COLUMN production_resources.resource_type IS 'Type: MACHINE, LABOR, INSTRUMENT, FACILITY';
COMMENT ON COLUMN production_resources.power_kw IS 'Electrical power consumption in kW (for energy cost calculations)';
COMMENT ON COLUMN production_resources.location IS 'Physical location: Sušárna, Extrakce, Mlýn, Plnění, Macerace';
COMMENT ON COLUMN production_resources.operating_cost_per_hour IS 'Computed operating cost per hour (energy + depreciation)';
