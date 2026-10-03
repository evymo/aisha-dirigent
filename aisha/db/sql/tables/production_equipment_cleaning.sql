-- Table: production_equipment_cleaning
-- Cleaning and sanitation records for GMP compliance
-- Maps to erp-basis.md: Cleaning / Sanitation entity (method, swab_results, verification)
-- GMP requirement: equipment cleaning between batches must be documented and verified
-- RLS: ENABLED

CREATE TABLE IF NOT EXISTS production_equipment_cleaning (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  equipment_id uuid NOT NULL,
  cleaning_method text NOT NULL,
  cleaning_agent text,
  performed_at timestamptz NOT NULL,
  performed_by uuid,
  verified_by uuid,
  verified_at timestamptz,
  swab_results jsonb,
  visual_inspection text,
  status text DEFAULT 'completed' NOT NULL,
  batch_id_before uuid,
  batch_id_after uuid,
  notes text,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now() NOT NULL,
  PRIMARY KEY (id),
  CONSTRAINT production_equipment_cleaning_status_check CHECK (
    status IN ('scheduled', 'in_progress', 'completed', 'failed', 'verified')
  ),
  CONSTRAINT production_equipment_cleaning_equipment_fkey FOREIGN KEY (equipment_id) REFERENCES production_equipment(id) ON DELETE CASCADE,
  CONSTRAINT production_equipment_cleaning_performed_by_fkey FOREIGN KEY (performed_by) REFERENCES aisha_auth.users(id),
  CONSTRAINT production_equipment_cleaning_verified_by_fkey FOREIGN KEY (verified_by) REFERENCES aisha_auth.users(id),
  CONSTRAINT production_equipment_cleaning_before_fkey FOREIGN KEY (batch_id_before) REFERENCES production_batches(id) ON DELETE SET NULL,
  CONSTRAINT production_equipment_cleaning_after_fkey FOREIGN KEY (batch_id_after) REFERENCES production_batches(id) ON DELETE SET NULL
);

ALTER TABLE production_equipment_cleaning ENABLE ROW LEVEL SECURITY;

-- Grants: admin-managed, read for authenticated
GRANT SELECT ON production_equipment_cleaning TO authenticated;
GRANT ALL ON production_equipment_cleaning TO service_role;

-- Indexes

-- Column documentation
COMMENT ON TABLE production_equipment_cleaning IS 'Cleaning and sanitation records. Per erp-basis.md: documented cleaning between batches with method, agent, swab results, and dual verification.';
COMMENT ON COLUMN production_equipment_cleaning.cleaning_method IS 'Method: manual_wash, cip (clean-in-place), rinse, solvent_wash, autoclave';
COMMENT ON COLUMN production_equipment_cleaning.cleaning_agent IS 'Cleaning agent used: water, ethanol, isopropanol, detergent, etc.';
COMMENT ON COLUMN production_equipment_cleaning.swab_results IS 'JSONB: [{location, residue_type, value, limit, result}]';
COMMENT ON COLUMN production_equipment_cleaning.visual_inspection IS 'Visual inspection result: clean, residue_visible, not_inspected';
COMMENT ON COLUMN production_equipment_cleaning.batch_id_before IS 'Last batch before cleaning (for cross-contamination traceability)';
COMMENT ON COLUMN production_equipment_cleaning.batch_id_after IS 'First batch after cleaning (for cross-contamination traceability)';
