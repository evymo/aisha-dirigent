-- Index: idx_production_batch_materials_lot
CREATE INDEX IF NOT EXISTS idx_production_batch_materials_lot ON production_batch_materials (lot_id) WHERE lot_id IS NOT NULL;
