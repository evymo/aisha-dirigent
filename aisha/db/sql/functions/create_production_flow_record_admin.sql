-- Function: public.create_production_flow_record_admin
-- Creates an immutable flow record (substance movement between nodes).
-- No update — records are regulatory-immutable.
-- SECURITY DEFINER with admin guard and audit log

CREATE OR REPLACE FUNCTION public.create_production_flow_record_admin(
  p_batch_id uuid DEFAULT NULL,
  p_concentration_pct numeric DEFAULT NULL,
  p_flow_date timestamptz DEFAULT now(),
  p_lot_id uuid DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb,
  p_notes text DEFAULT NULL,
  p_source_node_id uuid DEFAULT NULL,
  p_substance_id uuid DEFAULT NULL,
  p_target_node_id uuid DEFAULT NULL,
  p_temperature_c numeric DEFAULT NULL,
  p_volume_l numeric DEFAULT NULL
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
    RAISE EXCEPTION 'Access denied: admin or staff role required'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Validate required fields
  IF p_batch_id IS NULL THEN
    RAISE EXCEPTION 'batch_id is required'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_substance_id IS NULL THEN
    RAISE EXCEPTION 'substance_id is required'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_source_node_id IS NULL THEN
    RAISE EXCEPTION 'source_node_id is required'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_target_node_id IS NULL THEN
    RAISE EXCEPTION 'target_node_id is required'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_volume_l IS NULL OR p_volume_l <= 0 THEN
    RAISE EXCEPTION 'volume_l must be > 0'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_concentration_pct IS NULL OR p_concentration_pct < 0 OR p_concentration_pct > 100 THEN
    RAISE EXCEPTION 'concentration_pct must be between 0 and 100'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_source_node_id = p_target_node_id THEN
    RAISE EXCEPTION 'source and target node cannot be the same'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  INSERT INTO public.production_flow_records (
    batch_id, substance_id, source_node_id, target_node_id,
    flow_date, volume_l, concentration_pct,
    temperature_c, lot_id, responsible_user_id,
    notes, metadata
  ) VALUES (
    p_batch_id, p_substance_id, p_source_node_id, p_target_node_id,
    p_flow_date, p_volume_l, p_concentration_pct,
    p_temperature_c, p_lot_id, auth.uid(),
    p_notes, p_metadata
  )
  RETURNING id INTO v_result_id;

  PERFORM public.write_audit_journal(
    p_action_type := 'create'::public.journal_action_type,
    p_area := 'products'::public.journal_area,
    p_details := NULL,
    p_entity_id := v_result_id::text,
    p_entity_type := 'production_flow_record',
    p_new_values := jsonb_build_object(
      'batch_id', p_batch_id,
      'substance_id', p_substance_id,
      'source_node_id', p_source_node_id,
      'target_node_id', p_target_node_id,
      'volume_l', p_volume_l,
      'concentration_pct', p_concentration_pct
    ),
    p_old_values := NULL,
    p_severity := 'notice'::public.journal_severity,
    p_summary := format('Admin created flow record: %s L at %s%%', p_volume_l, p_concentration_pct),
    p_tags := ARRAY['admin', 'flow_tracking'],
    p_user_id := auth.uid()
  );

  RETURN v_result_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.create_production_flow_record_admin(uuid, numeric, timestamptz, uuid, jsonb, text, uuid, uuid, uuid, numeric, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_production_flow_record_admin(uuid, numeric, timestamptz, uuid, jsonb, text, uuid, uuid, uuid, numeric, numeric) TO authenticated;
