-- Index: idx_production_deviations_equipment
CREATE INDEX IF NOT EXISTS idx_production_deviations_equipment ON production_deviations (equipment_id) WHERE equipment_id IS NOT NULL;
