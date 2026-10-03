-- Table: production_equipment_calibrations
-- Calibration records for GMP-critical equipment
-- Maps to erp-basis.md: Equipment calibration entity (cal_type, result, certificate)
-- Required by EU GMP Annex 15 (qualification/validation) and Annex 11 (computerized systems)
-- RLS: ENABLED

CREATE TABLE IF NOT EXISTS production_equipment_calibrations (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  equipment_id uuid NOT NULL,
  calibration_type text NOT NULL,
  performed_at timestamptz NOT NULL,
  next_due_at date,
  result text NOT NULL DEFAULT 'pass',
  certificate_doc_id uuid,
  reference_standard text,
  deviation_found numeric(16,6),
  deviation_limit numeric(16,6),
  adjustment_made boolean DEFAULT false,
  performed_by uuid,
  verified_by uuid,
  verified_at timestamptz,
  notes text,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now() NOT NULL,
  PRIMARY KEY (id),
  CONSTRAINT production_equipment_calibrations_result_check CHECK (
    result IN ('pass', 'fail', 'adjusted', 'out_of_tolerance', 'not_applicable')
  ),
  CONSTRAINT production_equipment_calibrations_equipment_fkey FOREIGN KEY (equipment_id) REFERENCES production_equipment(id) ON DELETE CASCADE,
  CONSTRAINT production_equipment_calibrations_performed_by_fkey FOREIGN KEY (performed_by) REFERENCES aisha_auth.users(id),
  CONSTRAINT production_equipment_calibrations_verified_by_fkey FOREIGN KEY (verified_by) REFERENCES aisha_auth.users(id)
);

ALTER TABLE production_equipment_calibrations ENABLE ROW LEVEL SECURITY;

-- Grants: admin-managed, read for authenticated
GRANT SELECT ON production_equipment_calibrations TO authenticated;
GRANT ALL ON production_equipment_calibrations TO service_role;

-- Indexes

-- Column documentation
COMMENT ON TABLE production_equipment_calibrations IS 'Calibration records for equipment. Per erp-basis.md: traceable calibration history with certificate references and next-due scheduling.';
COMMENT ON COLUMN production_equipment_calibrations.calibration_type IS 'Type: routine, preventive, post_repair, initial, requalification';
COMMENT ON COLUMN production_equipment_calibrations.reference_standard IS 'Calibration reference standard used (traceability to national/international standards)';
COMMENT ON COLUMN production_equipment_calibrations.deviation_found IS 'Measured deviation from reference (for trending)';
COMMENT ON COLUMN production_equipment_calibrations.deviation_limit IS 'Maximum allowable deviation (spec limit)';
