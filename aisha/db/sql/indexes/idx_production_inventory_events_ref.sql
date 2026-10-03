-- Index: idx_production_inventory_events_ref
CREATE INDEX IF NOT EXISTS idx_production_inventory_events_ref ON production_inventory_events (ref_type, ref_id) WHERE ref_id IS NOT NULL;
