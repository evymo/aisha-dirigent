-- Function: public.get_health_summary
-- Arguments: p_days integer
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:26:48+01:00

CREATE OR REPLACE FUNCTION public.get_health_summary(p_days integer DEFAULT 7)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id UUID;
  v_result JSON;
BEGIN
  v_user_id := auth.uid();

  IF v_user_id IS NULL THEN
    RETURN json_build_object('error_code', 'auth.not_authenticated');
  END IF;

  PERFORM public.write_audit_journal(
      p_action_type := 'read'::journal_action_type,
      p_area := 'health'::journal_area,
      p_details := jsonb_build_object('days', p_days),
      p_entity_id := v_user_id::text,
      p_entity_type := 'health_data',
      p_severity := 'info'::journal_severity,
      p_summary := 'Read own health summary',
    p_user_id := v_user_id
  );

  -- Build summary (keep existing logic from baseline migration)
  SELECT json_build_object(
    'period_days', p_days,
    'steps', (
      SELECT json_build_object(
        'total', COALESCE(SUM(value), 0),
        'avg_daily', COALESCE(AVG(daily_total), 0),
        'max_daily', COALESCE(MAX(daily_total), 0)
      )
      FROM (
        SELECT SUM(value) as daily_total
        FROM health_data
        WHERE user_id = v_user_id
          AND data_type = 'steps'
          AND recorded_at >= NOW() - (p_days || ' days')::interval
        GROUP BY DATE(recorded_at)
      ) daily
    ),
    'heart_rate', (
      SELECT json_build_object(
        'avg', COALESCE(AVG(value), 0),
        'min', COALESCE(MIN(value), 0),
        'max', COALESCE(MAX(value), 0)
      )
      FROM health_data
      WHERE user_id = v_user_id
        AND data_type = 'heart_rate'
        AND recorded_at >= NOW() - (p_days || ' days')::interval
    ),
    'sleep', (
      SELECT json_build_object(
        'total_hours', COALESCE(SUM(value), 0),
        'avg_hours', COALESCE(AVG(value), 0)
      )
      FROM health_data
      WHERE user_id = v_user_id
        AND data_type = 'sleep'
        AND recorded_at >= NOW() - (p_days || ' days')::interval
    ),
    'active_energy', (
      SELECT json_build_object(
        'total', COALESCE(SUM(value), 0),
        'avg_daily', COALESCE(AVG(daily_total), 0)
      )
      FROM (
        SELECT SUM(value) as daily_total
        FROM health_data
        WHERE user_id = v_user_id
          AND data_type = 'active_energy'
          AND recorded_at >= NOW() - (p_days || ' days')::interval
        GROUP BY DATE(recorded_at)
      ) daily
    ),
    'weight', (
      SELECT json_build_object(
        'latest', value,
        'unit', unit,
        'recorded_at', recorded_at
      )
      FROM health_data
      WHERE user_id = v_user_id
        AND data_type = 'weight'
      ORDER BY recorded_at DESC
      LIMIT 1
    )
  ) INTO v_result;

  RETURN v_result;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_health_summary(p_days integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_health_summary(p_days integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_health_summary(p_days integer) TO authenticated;
