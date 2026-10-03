-- Index: idx_sensor_alerts_unacked
-- Table: production_sensor_alerts
-- Source: Migration 20260219180000_production_enhancements.sql

CREATE INDEX IF NOT EXISTS idx_sensor_alerts_unacked
  ON public.production_sensor_alerts (acknowledged_at)
  WHERE acknowledged_at IS NULL;
