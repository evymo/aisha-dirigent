-- Index: idx_production_eq_clean_performed
CREATE INDEX IF NOT EXISTS idx_production_eq_clean_performed ON production_equipment_cleaning (performed_at);
