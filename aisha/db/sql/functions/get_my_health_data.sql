-- Function: public.get_my_health_data
-- Arguments: p_data_type text, p_from_date timestamp with time zone, p_to_date timestamp with time zone, p_limit integer
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:26:57+01:00

CREATE OR REPLACE FUNCTION public.get_my_health_data(p_data_type text DEFAULT NULL::text, p_from_date timestamp with time zone DEFAULT NULL::timestamp with time zone, p_to_date timestamp with time zone DEFAULT NULL::timestamp with time zone, p_limit integer DEFAULT 100)
 RETURNS TABLE(id uuid, data_type text, value numeric, unit text, metadata jsonb, recorded_at timestamptz, source text, created_at timestamptz)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id UUID;
BEGIN
  v_user_id := auth.uid();

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  PERFORM public.write_audit_journal(
      p_action_type := 'read'::journal_action_type,
      p_area := 'health'::journal_area,
      p_details := jsonb_build_object(
      'data_type', p_data_type,
      'from_date', p_from_date,
      'to_date', p_to_date,
      'limit', p_limit
    ),
      p_entity_id := v_user_id::text,
      p_entity_type := 'health_data',
      p_severity := 'info'::journal_severity,
      p_summary := 'Read own health data',
    p_user_id := v_user_id
  );

  RETURN QUERY
  SELECT
    hd.id,
    hd.data_type,
    hd.value,
    hd.unit,
    hd.metadata,
    hd.recorded_at,
    hd.source,
    hd.created_at
  FROM health_data hd
  WHERE hd.user_id = v_user_id
    AND (p_data_type IS NULL OR hd.data_type = p_data_type)
    AND (p_from_date IS NULL OR hd.recorded_at >= p_from_date)
    AND (p_to_date IS NULL OR hd.recorded_at <= p_to_date)
  ORDER BY hd.recorded_at DESC
  LIMIT p_limit;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_my_health_data(p_data_type text, p_from_date timestamp with time zone, p_to_date timestamp with time zone, p_limit integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_my_health_data(p_data_type text, p_from_date timestamp with time zone, p_to_date timestamp with time zone, p_limit integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_my_health_data(p_data_type text, p_from_date timestamp with time zone, p_to_date timestamp with time zone, p_limit integer) TO authenticated;
