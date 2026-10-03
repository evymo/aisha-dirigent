-- Table: production_flow_substances
-- Master list of tracked substances (ethanol, water, terpene extract, etc.).
-- Referenced by flow records to enable per-substance balance calculations.
-- RLS: ENABLED

CREATE TABLE IF NOT EXISTS production_flow_substances (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  substance_code text NOT NULL,
  substance_name text NOT NULL,
  -- Physical / regulatory properties
  cas_number text,                         -- CAS registry number (e.g. 64-17-5 for ethanol)
  density_kg_l numeric(8,4),              -- Density at 20°C
  regulatory_class text,                   -- 'excise_duty', 'hazmat', 'food_grade', 'pharma' …
  default_unit text NOT NULL DEFAULT 'l', -- default volume unit
  default_concentration_pct numeric(6,3) DEFAULT 100,
  is_active boolean NOT NULL DEFAULT true,
  notes text,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  PRIMARY KEY (id),
  CONSTRAINT production_flow_substances_substance_code_key UNIQUE (substance_code),
  CONSTRAINT production_flow_substances_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES aisha_auth.users(id)
);

ALTER TABLE production_flow_substances ENABLE ROW LEVEL SECURITY;

-- Grants
GRANT SELECT ON production_flow_substances TO authenticated;
GRANT ALL ON production_flow_substances TO service_role;

-- Comments
COMMENT ON TABLE production_flow_substances IS 'Master list of substances tracked through production flow nodes — ethanol, solvents, extracts, water, etc.';
COMMENT ON COLUMN production_flow_substances.cas_number IS 'Chemical Abstracts Service registry number for regulatory identification.';
COMMENT ON COLUMN production_flow_substances.regulatory_class IS 'Regulatory classification: excise_duty, hazmat, food_grade, pharma, cosmetic, etc.';
COMMENT ON COLUMN production_flow_substances.default_concentration_pct IS 'Default concentration (0–100%) for this substance when undiluted.';
