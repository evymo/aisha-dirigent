-- Index: idx_production_locations_active
CREATE INDEX IF NOT EXISTS idx_production_locations_active ON production_locations (is_active) WHERE is_active = true;
