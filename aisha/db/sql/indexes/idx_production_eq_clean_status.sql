-- Index: idx_production_eq_clean_status
CREATE INDEX IF NOT EXISTS idx_production_eq_clean_status ON production_equipment_cleaning (status);
