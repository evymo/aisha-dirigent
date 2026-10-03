-- Index: idx_production_lots_supplier
CREATE INDEX IF NOT EXISTS idx_production_lots_supplier ON production_lots (supplier_id) WHERE supplier_id IS NOT NULL;
