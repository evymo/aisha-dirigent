-- Function: public.get_production_sensor_alerts_admin
-- Arguments: p_acknowledged boolean, p_batch_id uuid, p_limit integer, p_severity text
-- Description: Get sensor alerts with optional filters for batch, severity and acknowledged status.
-- Security: SECURITY DEFINER, admin/staff only
-- Source: Migration 20260219180000_production_enhancements.sql

CREATE OR REPLACE FUNCTION public.get_production_sensor_alerts_admin(
  p_acknowledged boolean DEFAULT NULL,
  p_batch_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 100,
  p_severity text DEFAULT NULL
)
RETURNS TABLE(
  id uuid,
  sensor_reading_id uuid,
  flow_node_id uuid,
  equipment_id uuid,
  batch_id uuid,
  alert_type text,
  severity text,
  reading_type text,
  reading_value numeric,
  threshold_min numeric,
  threshold_max numeric,
  message text,
  acknowledged_by uuid,
  acknowledged_at timestamptz,
  resolved_by uuid,
  resolved_at timestamptz,
  resolution_notes text,
  notified_channels text[],
  metadata jsonb,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.is_admin_or_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Access denied: admin or staff role required';
  END IF;

  RETURN QUERY
  SELECT
    a.id, a.sensor_reading_id, a.flow_node_id, a.equipment_id, a.batch_id,
    a.alert_type, a.severity, a.reading_type, a.reading_value,
    a.threshold_min, a.threshold_max, a.message,
    a.acknowledged_by, a.acknowledged_at,
    a.resolved_by, a.resolved_at, a.resolution_notes,
    a.notified_channels, a.metadata, a.created_at
  FROM production_sensor_alerts a
  WHERE (p_batch_id IS NULL OR a.batch_id = p_batch_id)
    AND (p_severity IS NULL OR a.severity = p_severity)
    AND (p_acknowledged IS NULL
      OR (p_acknowledged = true AND a.acknowledged_at IS NOT NULL)
      OR (p_acknowledged = false AND a.acknowledged_at IS NULL))
  ORDER BY a.created_at DESC
  LIMIT p_limit;
END;
$$;

REVOKE ALL ON FUNCTION public.get_production_sensor_alerts_admin(boolean, uuid, integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_production_sensor_alerts_admin(boolean, uuid, integer, text) TO authenticated;
