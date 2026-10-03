-- Index: idx_production_sensor_location
CREATE INDEX IF NOT EXISTS idx_production_sensor_location ON production_sensor_readings (location_id) WHERE location_id IS NOT NULL;
