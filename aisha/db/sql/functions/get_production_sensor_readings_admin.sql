-- Function: public.get_production_sensor_readings_admin
-- Returns IoT/HomeAssistant sensor readings
-- SECURITY DEFINER with admin guard and audit log

CREATE OR REPLACE FUNCTION public.get_production_sensor_readings_admin(
  p_batch_id uuid DEFAULT NULL,
  p_equipment_id uuid DEFAULT NULL,
  p_flow_node_id uuid DEFAULT NULL,
  p_is_excursion boolean DEFAULT NULL,
  p_limit integer DEFAULT 500,
  p_location_id uuid DEFAULT NULL,
  p_reading_type text DEFAULT NULL,
  p_sensor_code text DEFAULT NULL
)
RETURNS TABLE(
  id uuid,
  sensor_code text,
  location_id uuid,
  equipment_id uuid,
  batch_id uuid,
  flow_node_id uuid,
  reading_type text,
  value numeric,
  unit text,
  recorded_at timestamptz,
  source text,
  is_excursion boolean,
  excursion_severity text,
  excursion_acknowledged_by uuid,
  excursion_acknowledged_at timestamptz,
  metadata jsonb,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.is_admin_or_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Access denied: admin or staff role required';
  END IF;

  PERFORM public.write_audit_journal(
    p_action_type := 'read'::public.journal_action_type,
    p_area := 'products'::public.journal_area,
    p_details := NULL,
    p_entity_id := NULL,
    p_entity_type := 'production_sensor_reading',
    p_new_values := jsonb_build_object('sensor_code', p_sensor_code, 'reading_type', p_reading_type, 'flow_node_id', p_flow_node_id, 'limit', p_limit),
    p_old_values := NULL,
    p_severity := 'notice'::public.journal_severity,
    p_summary := 'Admin read production sensor readings',
    p_tags := ARRAY['admin', 'production_sensor_reading'],
    p_user_id := auth.uid()
  );

  RETURN QUERY
  SELECT
    psr.id, psr.sensor_code, psr.location_id, psr.equipment_id,
    psr.batch_id, psr.flow_node_id, psr.reading_type, psr.value, psr.unit,
    psr.recorded_at, psr.source, psr.is_excursion,
    psr.excursion_severity, psr.excursion_acknowledged_by,
    psr.excursion_acknowledged_at, psr.metadata, psr.created_at
  FROM public.production_sensor_readings psr
  WHERE (p_batch_id IS NULL OR psr.batch_id = p_batch_id)
    AND (p_equipment_id IS NULL OR psr.equipment_id = p_equipment_id)
    AND (p_flow_node_id IS NULL OR psr.flow_node_id = p_flow_node_id)
    AND (p_is_excursion IS NULL OR psr.is_excursion = p_is_excursion)
    AND (p_location_id IS NULL OR psr.location_id = p_location_id)
    AND (p_reading_type IS NULL OR psr.reading_type = p_reading_type)
    AND (p_sensor_code IS NULL OR psr.sensor_code = p_sensor_code)
  ORDER BY psr.recorded_at DESC
  LIMIT p_limit;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_production_sensor_readings_admin(uuid, uuid, uuid, boolean, integer, uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_production_sensor_readings_admin(uuid, uuid, uuid, boolean, integer, uuid, text, text) TO authenticated;
