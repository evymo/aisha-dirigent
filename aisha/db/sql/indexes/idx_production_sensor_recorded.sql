-- Index: idx_production_sensor_recorded
CREATE INDEX IF NOT EXISTS idx_production_sensor_recorded ON production_sensor_readings (recorded_at);
