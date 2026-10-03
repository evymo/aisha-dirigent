-- Index: idx_production_equipment_location
CREATE INDEX IF NOT EXISTS idx_production_equipment_location ON production_equipment (location_id) WHERE location_id IS NOT NULL;
