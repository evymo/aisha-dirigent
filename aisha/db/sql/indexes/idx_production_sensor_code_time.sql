-- Index: idx_production_sensor_code_time
CREATE INDEX IF NOT EXISTS idx_production_sensor_code_time ON production_sensor_readings (sensor_code, recorded_at DESC);
