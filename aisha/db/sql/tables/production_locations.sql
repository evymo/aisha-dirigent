-- Table: production_locations
-- Facility, warehouse, and zone master data
-- Maps to erp-basis.md: Location entity (farm/plant/warehouse/lab/3pl, gmp_zone, temp/humidity ranges)
-- RLS: ENABLED

CREATE TABLE IF NOT EXISTS production_locations (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  location_code text NOT NULL,
  location_name text NOT NULL,
  location_type text NOT NULL DEFAULT 'plant',
  address jsonb,
  gmp_zone text,
  temp_range_min numeric(6,2),
  temp_range_max numeric(6,2),
  humidity_range_min numeric(6,2),
  humidity_range_max numeric(6,2),
  parent_location_id uuid,
  is_active boolean DEFAULT true NOT NULL,
  notes text,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now(),
  created_by uuid,
  PRIMARY KEY (id),
  CONSTRAINT production_locations_code_key UNIQUE (location_code),
  CONSTRAINT production_locations_type_check CHECK (
    location_type IN ('farm', 'plant', 'warehouse', 'lab', '3pl', 'field', 'drying_room', 'extraction_room', 'filling_room', 'storage')
  ),
  CONSTRAINT production_locations_parent_fkey FOREIGN KEY (parent_location_id) REFERENCES production_locations(id),
  CONSTRAINT production_locations_created_by_fkey FOREIGN KEY (created_by) REFERENCES aisha_auth.users(id)
);

ALTER TABLE production_locations ENABLE ROW LEVEL SECURITY;

-- Grants: admin-managed, read for authenticated
GRANT SELECT ON production_locations TO authenticated;
GRANT ALL ON production_locations TO service_role;

-- Indexes

-- Column documentation
COMMENT ON TABLE production_locations IS 'Facility, warehouse, and zone master data. Hierarchical (parent_location_id). Per erp-basis.md: storage qualification, GMP zones, environmental limits.';
COMMENT ON COLUMN production_locations.location_code IS 'Unique location code, e.g. LOC-PLANT-01, LOC-SUSARNA, LOC-SKLAD-ETOH';
COMMENT ON COLUMN production_locations.gmp_zone IS 'GMP classification: clean_room, controlled, uncontrolled, outdoor';
COMMENT ON COLUMN production_locations.temp_range_min IS 'Minimum allowed temperature (°C) for storage qualification';
COMMENT ON COLUMN production_locations.temp_range_max IS 'Maximum allowed temperature (°C) for storage qualification';
COMMENT ON COLUMN production_locations.humidity_range_min IS 'Minimum allowed relative humidity (%) for storage qualification';
COMMENT ON COLUMN production_locations.humidity_range_max IS 'Maximum allowed relative humidity (%) for storage qualification';
COMMENT ON COLUMN production_locations.parent_location_id IS 'Parent location for hierarchical structure (e.g. room within plant)';
