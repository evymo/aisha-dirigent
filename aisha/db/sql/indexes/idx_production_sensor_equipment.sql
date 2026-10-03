-- Index: idx_production_sensor_equipment
CREATE INDEX IF NOT EXISTS idx_production_sensor_equipment ON production_sensor_readings (equipment_id) WHERE equipment_id IS NOT NULL;
