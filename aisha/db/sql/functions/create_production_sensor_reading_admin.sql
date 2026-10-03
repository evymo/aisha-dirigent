-- Function: public.create_production_sensor_reading_admin
-- Creates sensor reading(s) from IoT/HomeAssistant data
-- SECURITY DEFINER with admin guard and audit log
-- Designed for single or bulk insert via edge function

CREATE OR REPLACE FUNCTION public.create_production_sensor_reading_admin(
  p_batch_id uuid DEFAULT NULL,
  p_equipment_id uuid DEFAULT NULL,
  p_flow_node_id uuid DEFAULT NULL,
  p_is_excursion boolean DEFAULT false,
  p_excursion_severity text DEFAULT NULL,
  p_location_id uuid DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb,
  p_reading_type text DEFAULT NULL,
  p_recorded_at timestamptz DEFAULT now(),
  p_sensor_code text DEFAULT NULL,
  p_source text DEFAULT 'homeassistant',
  p_unit text DEFAULT NULL,
  p_value numeric DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_result_id uuid;
BEGIN
  IF NOT public.is_admin_or_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Access denied: admin or staff role required';
  END IF;

  IF p_sensor_code IS NULL OR p_reading_type IS NULL OR p_value IS NULL OR p_unit IS NULL THEN
    RAISE EXCEPTION 'sensor_code, reading_type, value and unit are required';
  END IF;

  INSERT INTO public.production_sensor_readings (
    sensor_code, location_id, equipment_id, batch_id, flow_node_id,
    reading_type, value, unit, recorded_at,
    source, is_excursion, excursion_severity, metadata
  ) VALUES (
    p_sensor_code, p_location_id, p_equipment_id, p_batch_id, p_flow_node_id,
    p_reading_type, p_value, p_unit, p_recorded_at,
    p_source, p_is_excursion, p_excursion_severity, p_metadata
  )
  RETURNING id INTO v_result_id;

  -- Only audit excursions to avoid flooding audit_journal with routine readings
  IF p_is_excursion THEN
    PERFORM public.write_audit_journal(
      p_action_type := 'create'::public.journal_action_type,
      p_area := 'products'::public.journal_area,
      p_details := NULL,
      p_entity_id := v_result_id::text,
      p_entity_type := 'production_sensor_reading',
      p_new_values := jsonb_build_object('sensor_code', p_sensor_code, 'reading_type', p_reading_type, 'value', p_value, 'is_excursion', true, 'flow_node_id', p_flow_node_id),
      p_old_values := NULL,
      p_severity := 'warning'::public.journal_severity,
      p_summary := format('EXCURSION: sensor %s reading %s=%s %s', p_sensor_code, p_reading_type, p_value, p_unit),
      p_tags := ARRAY['admin', 'production_sensor_reading', 'excursion'],
      p_user_id := auth.uid()
    );
  END IF;

  RETURN v_result_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.create_production_sensor_reading_admin(uuid, uuid, uuid, boolean, text, uuid, jsonb, text, timestamptz, text, text, text, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_production_sensor_reading_admin(uuid, uuid, uuid, boolean, text, uuid, jsonb, text, timestamptz, text, text, text, numeric) TO authenticated;
