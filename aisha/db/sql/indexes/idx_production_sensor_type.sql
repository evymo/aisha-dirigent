-- Index: idx_production_sensor_type
CREATE INDEX IF NOT EXISTS idx_production_sensor_type ON production_sensor_readings (reading_type);
