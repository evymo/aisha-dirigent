-- Index: idx_production_inventory_events_location
CREATE INDEX IF NOT EXISTS idx_production_inventory_events_location ON production_inventory_events (location_id) WHERE location_id IS NOT NULL;
