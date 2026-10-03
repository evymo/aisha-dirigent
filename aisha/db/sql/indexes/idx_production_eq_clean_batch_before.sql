-- Index: idx_production_eq_clean_batch_before
CREATE INDEX IF NOT EXISTS idx_production_eq_clean_batch_before ON production_equipment_cleaning (batch_id_before) WHERE batch_id_before IS NOT NULL;
