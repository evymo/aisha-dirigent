-- Index: idx_sensor_alerts_batch
-- Table: production_sensor_alerts
-- Source: Migration 20260219180000_production_enhancements.sql

CREATE INDEX IF NOT EXISTS idx_sensor_alerts_batch
  ON public.production_sensor_alerts (batch_id)
  WHERE batch_id IS NOT NULL;
