-- Table: production_variants
-- Standard production variants (extraction method configurations)
-- Maps to ERP std_variant from storm-source-of-truth.md §6.2
-- RLS: ENABLED

CREATE TABLE IF NOT EXISTS production_variants (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  variant_code text NOT NULL,
  variant_name text NOT NULL,
  product text NOT NULL,
  description text,
  process_params jsonb DEFAULT '{}'::jsonb,
  is_active boolean DEFAULT true NOT NULL,
  is_default boolean DEFAULT false NOT NULL,
  sort_order integer DEFAULT 0,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now(),
  created_by uuid,
  PRIMARY KEY (id),
  CONSTRAINT production_variants_code_key UNIQUE (variant_code),
  CONSTRAINT production_variants_created_by_fkey FOREIGN KEY (created_by) REFERENCES aisha_auth.users(id)
);

ALTER TABLE production_variants ENABLE ROW LEVEL SECURITY;

-- Grants: read for authenticated, admin-managed
GRANT SELECT ON production_variants TO authenticated;
GRANT ALL ON production_variants TO service_role;

-- Column documentation
COMMENT ON TABLE production_variants IS 'Standard production variants defining extraction method configurations. ERP std_variant equivalent.';
COMMENT ON COLUMN production_variants.variant_code IS 'Unique code: SPO, SPO+, SPO++, EKO, EKO+, EKO++, BED, FL-T48, FL-SUSH';
COMMENT ON COLUMN production_variants.product IS 'Product line: Retisin, Floristen, Lyastin';
COMMENT ON COLUMN production_variants.process_params IS 'JSONB with variant-specific parameters: {soxhlet_volume_l, replenish_volume_l, steps_count, initial_charge_kg, etc.}';
COMMENT ON COLUMN production_variants.is_default IS 'Whether this is the default variant for the product';
