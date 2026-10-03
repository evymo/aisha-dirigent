-- Function: public.acknowledge_production_sensor_alert_admin
-- Arguments: p_alert_id uuid, p_resolution_notes text
-- Description: Acknowledge (and optionally resolve) a production sensor alert.
-- Security: SECURITY DEFINER, admin/staff only
-- Source: Migration 20260219180000_production_enhancements.sql

CREATE OR REPLACE FUNCTION public.acknowledge_production_sensor_alert_admin(
  p_alert_id uuid DEFAULT NULL,
  p_resolution_notes text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.is_admin_or_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Access denied: admin or staff role required';
  END IF;

  UPDATE production_sensor_alerts
  SET
    acknowledged_by = auth.uid(),
    acknowledged_at = now(),
    resolved_by = CASE WHEN p_resolution_notes IS NOT NULL THEN auth.uid() ELSE resolved_by END,
    resolved_at = CASE WHEN p_resolution_notes IS NOT NULL THEN now() ELSE resolved_at END,
    resolution_notes = COALESCE(p_resolution_notes, resolution_notes)
  WHERE id = p_alert_id;

  PERFORM public.write_audit_journal(
    p_action_type := 'update'::public.journal_action_type,
    p_area := 'production'::public.journal_area,
    p_details := NULL,
    p_entity_id := p_alert_id::text,
    p_entity_type := 'production_sensor_alert',
    p_new_values := jsonb_build_object('acknowledged', true),
    p_old_values := NULL,
    p_severity := 'info'::public.journal_severity,
    p_summary := 'Sensor alert acknowledged',
    p_tags := ARRAY['admin', 'sensor', 'alert_ack'],
    p_user_id := auth.uid()
  );

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.acknowledge_production_sensor_alert_admin(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.acknowledge_production_sensor_alert_admin(uuid, text) TO authenticated;
