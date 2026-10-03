-- Index: idx_production_bom_parent
CREATE INDEX IF NOT EXISTS idx_production_bom_parent ON production_bom_entries (parent_item_id);
