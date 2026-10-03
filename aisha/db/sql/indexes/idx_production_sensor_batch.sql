-- Index: idx_production_sensor_batch
CREATE INDEX IF NOT EXISTS idx_production_sensor_batch ON production_sensor_readings (batch_id) WHERE batch_id IS NOT NULL;
