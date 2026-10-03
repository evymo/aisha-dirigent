-- Function: public.create_production_sensor_alert_admin
-- Arguments: p_alert_type text, p_batch_id uuid, p_equipment_id uuid, p_flow_node_id uuid, p_message text, p_metadata jsonb, p_reading_type text, p_reading_value numeric, p_sensor_reading_id uuid, p_severity text, p_threshold_max numeric, p_threshold_min numeric
-- Description: Create a new sensor threshold alert for production monitoring.
-- Security: SECURITY DEFINER, admin/staff only
-- Source: Migration 20260219180000_production_enhancements.sql

CREATE OR REPLACE FUNCTION public.create_production_sensor_alert_admin(
  p_alert_type text DEFAULT NULL,
  p_batch_id uuid DEFAULT NULL,
  p_equipment_id uuid DEFAULT NULL,
  p_flow_node_id uuid DEFAULT NULL,
  p_message text DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb,
  p_reading_type text DEFAULT NULL,
  p_reading_value numeric DEFAULT NULL,
  p_sensor_reading_id uuid DEFAULT NULL,
  p_severity text DEFAULT 'warning',
  p_threshold_max numeric DEFAULT NULL,
  p_threshold_min numeric DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF NOT public.is_admin_or_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Access denied: admin or staff role required';
  END IF;

  INSERT INTO production_sensor_alerts (
    sensor_reading_id, flow_node_id, equipment_id, batch_id,
    alert_type, severity, reading_type, reading_value,
    threshold_min, threshold_max, message, metadata
  ) VALUES (
    p_sensor_reading_id, p_flow_node_id, p_equipment_id, p_batch_id,
    p_alert_type, p_severity, p_reading_type, p_reading_value,
    p_threshold_min, p_threshold_max, p_message, p_metadata
  )
  RETURNING id INTO v_id;

  PERFORM public.write_audit_journal(
    p_action_type := 'create'::public.journal_action_type,
    p_area := 'production'::public.journal_area,
    p_details := NULL,
    p_entity_id := v_id::text,
    p_entity_type := 'production_sensor_alert',
    p_new_values := jsonb_build_object(
      'alert_type', p_alert_type,
      'severity', p_severity,
      'reading_type', p_reading_type,
      'reading_value', p_reading_value
    ),
    p_old_values := NULL,
    p_severity := CASE p_severity
      WHEN 'critical' THEN 'error'::public.journal_severity
      WHEN 'warning' THEN 'warning'::public.journal_severity
      ELSE 'info'::public.journal_severity
    END,
    p_summary := format('Sensor alert: %s — %s', p_alert_type, p_message),
    p_tags := ARRAY['admin', 'sensor', 'alert', p_severity],
    p_user_id := auth.uid()
  );

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_production_sensor_alert_admin(text, uuid, uuid, uuid, text, jsonb, text, numeric, uuid, text, numeric, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_production_sensor_alert_admin(text, uuid, uuid, uuid, text, jsonb, text, numeric, uuid, text, numeric, numeric) TO authenticated;
