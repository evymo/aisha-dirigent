-- Index: idx_production_eq_cal_performed
CREATE INDEX IF NOT EXISTS idx_production_eq_cal_performed ON production_equipment_calibrations (performed_at);
