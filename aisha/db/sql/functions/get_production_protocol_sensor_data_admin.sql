-- Function: get_production_protocol_sensor_data_admin
-- Aggregates sensor readings per batch + flow node for protocol verification
-- Used to show IoT sensor data summary when completing protocol steps
-- Security: SECURITY DEFINER, admin/staff only, audited

CREATE OR REPLACE FUNCTION public.get_production_protocol_sensor_data_admin(
  p_batch_id uuid,
  p_flow_node_id uuid DEFAULT NULL,
  p_hours_back integer DEFAULT 168
)
RETURNS TABLE(
  flow_node_id uuid,
  node_code text,
  node_name text,
  reading_type text,
  avg_value numeric,
  min_value numeric,
  max_value numeric,
  latest_value numeric,
  latest_unit text,
  reading_count bigint,
  latest_recorded_at timestamptz,
  has_excursion boolean,
  excursion_count bigint
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
    p_entity_id := p_batch_id,
    p_entity_type := 'production_protocol_sensor_data',
    p_new_values := jsonb_build_object(
      'batch_id', p_batch_id,
      'flow_node_id', p_flow_node_id,
      'hours_back', p_hours_back
    ),
    p_old_values := NULL,
    p_severity := 'notice'::public.journal_severity,
    p_summary := 'Admin read production protocol sensor data',
    p_tags := ARRAY['admin', 'production_sensor_reading', 'protocol_verification'],
    p_user_id := auth.uid()
  );

  RETURN QUERY
  SELECT
    pfn.id AS flow_node_id,
    pfn.node_code,
    pfn.node_name,
    psr.reading_type,
    ROUND(AVG(psr.value), 4) AS avg_value,
    MIN(psr.value) AS min_value,
    MAX(psr.value) AS max_value,
    (ARRAY_AGG(psr.value ORDER BY psr.recorded_at DESC))[1] AS latest_value,
    (ARRAY_AGG(psr.unit ORDER BY psr.recorded_at DESC))[1] AS latest_unit,
    COUNT(*)::bigint AS reading_count,
    MAX(psr.recorded_at) AS latest_recorded_at,
    BOOL_OR(psr.is_excursion) AS has_excursion,
    COUNT(*) FILTER (WHERE psr.is_excursion)::bigint AS excursion_count
  FROM public.production_sensor_readings psr
  INNER JOIN public.production_flow_nodes pfn ON pfn.id = psr.flow_node_id
  WHERE psr.batch_id = p_batch_id
    AND psr.recorded_at >= (now() - (p_hours_back || ' hours')::interval)
    AND (p_flow_node_id IS NULL OR psr.flow_node_id = p_flow_node_id)
  GROUP BY pfn.id, pfn.node_code, pfn.node_name, psr.reading_type
  ORDER BY pfn.node_code, psr.reading_type;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_production_protocol_sensor_data_admin(uuid, uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_production_protocol_sensor_data_admin(uuid, uuid, integer) TO authenticated;
