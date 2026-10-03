-- Table: public.production_sensor_alerts
-- Description: Sensor threshold alerts for production monitoring (temperature, humidity, pressure, etc.).
-- Source: Migration 20260219180000_production_enhancements.sql

CREATE TABLE IF NOT EXISTS public.production_sensor_alerts (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  sensor_reading_id uuid REFERENCES public.production_sensor_readings(id),
  flow_node_id uuid REFERENCES public.production_flow_nodes(id),
  equipment_id uuid REFERENCES public.production_equipment(id),
  batch_id uuid REFERENCES public.production_batches(id),
  alert_type text NOT NULL CHECK (alert_type IN ('threshold_exceeded', 'threshold_below', 'excursion', 'sensor_offline', 'calibration_due')),
  severity text NOT NULL DEFAULT 'warning' CHECK (severity IN ('info', 'warning', 'critical')),
  reading_type text NOT NULL,
  reading_value numeric(16,6),
  threshold_min numeric(16,6),
  threshold_max numeric(16,6),
  message text NOT NULL,
  acknowledged_by uuid REFERENCES aisha_auth.users(id),
  acknowledged_at timestamptz,
  resolved_by uuid REFERENCES aisha_auth.users(id),
  resolved_at timestamptz,
  resolution_notes text,
  notified_channels text[] DEFAULT '{}',
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);

ALTER TABLE public.production_sensor_alerts ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE ON public.production_sensor_alerts TO authenticated;
