-- Index: idx_production_locations_parent
CREATE INDEX IF NOT EXISTS idx_production_locations_parent ON production_locations (parent_location_id) WHERE parent_location_id IS NOT NULL;
