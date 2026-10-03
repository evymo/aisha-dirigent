-- Index: idx_production_sensor_excursion
CREATE INDEX IF NOT EXISTS idx_production_sensor_excursion ON production_sensor_readings (is_excursion) WHERE is_excursion = true;
