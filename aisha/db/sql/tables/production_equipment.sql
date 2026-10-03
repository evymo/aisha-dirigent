-- Table: production_equipment
-- Equipment/asset master with GMP qualification management
-- Maps to erp-basis.md: Equipment entity (asset_tag, qualification_status, GMP criticality)
-- Required by EU GMP Annex 11/15 for instrument qualification (IQ/OQ/PQ)
-- RLS: ENABLED

CREATE TABLE IF NOT EXISTS production_equipment (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  asset_tag text NOT NULL,
  equipment_name text NOT NULL,
  model text,
  serial_no text,
  manufacturer text,
  resource_id uuid,
  location_id uuid,
  gmp_criticality text DEFAULT 'standard' NOT NULL,
  qualification_status text DEFAULT 'pending' NOT NULL,
  last_qualified_at timestamptz,
  next_qualification_due date,
  power_kw numeric(8,2),
  is_active boolean DEFAULT true NOT NULL,
  notes text,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now(),
  created_by uuid,
  PRIMARY KEY (id),
  CONSTRAINT production_equipment_tag_key UNIQUE (asset_tag),
  CONSTRAINT production_equipment_criticality_check CHECK (
    gmp_criticality IN ('critical', 'major', 'standard', 'non_gmp')
  ),
  CONSTRAINT production_equipment_qualification_check CHECK (
    qualification_status IN ('pending', 'iq_complete', 'oq_complete', 'pq_complete', 'qualified', 'decommissioned', 'out_of_service')
  ),
  CONSTRAINT production_equipment_resource_fkey FOREIGN KEY (resource_id) REFERENCES production_resources(id) ON DELETE SET NULL,
  CONSTRAINT production_equipment_location_fkey FOREIGN KEY (location_id) REFERENCES production_locations(id) ON DELETE SET NULL,
  CONSTRAINT production_equipment_created_by_fkey FOREIGN KEY (created_by) REFERENCES aisha_auth.users(id)
);

ALTER TABLE production_equipment ENABLE ROW LEVEL SECURITY;

-- Grants: admin-managed, read for authenticated
GRANT SELECT ON production_equipment TO authenticated;
GRANT ALL ON production_equipment TO service_role;

-- Indexes

-- Column documentation
COMMENT ON TABLE production_equipment IS 'Equipment/asset master with GMP qualification. Per erp-basis.md: asset_tag, qualification lifecycle (IQ/OQ/PQ), criticality assessment.';
COMMENT ON COLUMN production_equipment.asset_tag IS 'Unique asset identifier, e.g. EQ-VENTICEL-707, EQ-BALLMILL-01, EQ-SOXHLET-1L';
COMMENT ON COLUMN production_equipment.gmp_criticality IS 'GMP criticality based on impact assessment: critical (direct product contact), major, standard, non_gmp';
COMMENT ON COLUMN production_equipment.qualification_status IS 'Qualification lifecycle: pending → iq_complete → oq_complete → pq_complete → qualified | decommissioned';
COMMENT ON COLUMN production_equipment.resource_id IS 'Link to production_resources (work center type)';
COMMENT ON COLUMN production_equipment.location_id IS 'Physical location of the equipment';
