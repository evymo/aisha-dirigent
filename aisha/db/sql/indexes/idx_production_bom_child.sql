-- Index: idx_production_bom_child
CREATE INDEX IF NOT EXISTS idx_production_bom_child ON production_bom_entries (child_item_id);
