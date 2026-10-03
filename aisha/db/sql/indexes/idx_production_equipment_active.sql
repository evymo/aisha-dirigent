-- Index: idx_production_equipment_active
CREATE INDEX IF NOT EXISTS idx_production_equipment_active ON production_equipment (is_active) WHERE is_active = true;
