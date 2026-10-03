-- Index: idx_production_eq_cal_next_due
CREATE INDEX IF NOT EXISTS idx_production_eq_cal_next_due ON production_equipment_calibrations (next_due_at) WHERE next_due_at IS NOT NULL;
