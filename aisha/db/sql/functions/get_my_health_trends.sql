-- Function: public.get_my_health_trends
-- Arguments: p_period text, p_metric text
-- Description: Get health trends for current user
-- Security: authenticated only, accesses sensitive data
-- @security: authenticated
-- @audit: required
-- @phi: true

CREATE OR REPLACE FUNCTION public.get_my_health_trends(p_period text DEFAULT 'week'::text, p_metric text DEFAULT 'all'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id UUID;
  v_start_date DATE;
  v_result JSONB;
BEGIN
  v_user_id := auth.uid();

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Audit sensitive data access
  PERFORM public.write_audit_journal(
      p_action_type := 'view',
      p_area := 'studies',
      p_details := jsonb_build_object('period', p_period, 'metric', p_metric),
      p_entity_id := NULL,
      p_entity_type := 'health_trends',
      p_new_values := NULL,
      p_old_values := NULL,
      p_severity := 'notice',
      p_summary := 'Member viewed health trends',
      p_tags := ARRAY['phi','member','health_trends'],
      p_user_id := v_user_id
  );

  -- Calculate start date based on period
  v_start_date := CASE p_period
    WHEN 'week' THEN CURRENT_DATE - INTERVAL '7 days'
    WHEN 'month' THEN CURRENT_DATE - INTERVAL '30 days'
    WHEN 'quarter' THEN CURRENT_DATE - INTERVAL '90 days'
    WHEN 'year' THEN CURRENT_DATE - INTERVAL '365 days'
    ELSE CURRENT_DATE - INTERVAL '7 days'
  END;

  WITH daily_data AS (
    SELECT
      check_in_date,
      steps_count,
      sleep_hours,
      sleep_quality,
      energy_level,
      mood_level,
      pain_level,
      heart_rate_avg,
      heart_rate_min,
      heart_rate_max,
      active_energy_burned,
      distance_meters
    FROM health_check_ins
    WHERE user_id = v_user_id
      AND check_in_date >= v_start_date
    ORDER BY check_in_date
  ),
  aggregates AS (
    SELECT
      COUNT(*) as days_tracked,
      ROUND(AVG(steps_count)::NUMERIC, 0) as avg_steps,
      ROUND(AVG(sleep_hours)::NUMERIC, 1) as avg_sleep,
      ROUND(AVG(energy_level)::NUMERIC, 1) as avg_energy,
      ROUND(AVG(mood_level)::NUMERIC, 1) as avg_mood,
      ROUND(AVG(pain_level)::NUMERIC, 1) as avg_pain,
      ROUND(AVG(heart_rate_avg)::NUMERIC, 0) as avg_heart_rate,
      SUM(COALESCE(active_energy_burned, 0))::INTEGER as total_calories,
      SUM(COALESCE(distance_meters, 0))::INTEGER as total_distance
    FROM daily_data
  ),
  trend_calc AS (
    SELECT
      CASE
        WHEN AVG(CASE WHEN check_in_date >= CURRENT_DATE - 3 THEN energy_level END) >
             AVG(CASE WHEN check_in_date < CURRENT_DATE - 3 THEN energy_level END)
        THEN 'improving'
        WHEN AVG(CASE WHEN check_in_date >= CURRENT_DATE - 3 THEN energy_level END) <
             AVG(CASE WHEN check_in_date < CURRENT_DATE - 3 THEN energy_level END)
        THEN 'declining'
        ELSE 'stable'
      END as energy_trend,
      CASE
        WHEN AVG(CASE WHEN check_in_date >= CURRENT_DATE - 3 THEN mood_level END) >
             AVG(CASE WHEN check_in_date < CURRENT_DATE - 3 THEN mood_level END)
        THEN 'improving'
        WHEN AVG(CASE WHEN check_in_date >= CURRENT_DATE - 3 THEN mood_level END) <
             AVG(CASE WHEN check_in_date < CURRENT_DATE - 3 THEN mood_level END)
        THEN 'declining'
        ELSE 'stable'
      END as mood_trend,
      CASE
        WHEN AVG(CASE WHEN check_in_date >= CURRENT_DATE - 3 THEN steps_count END) >
             AVG(CASE WHEN check_in_date < CURRENT_DATE - 3 THEN steps_count END)
        THEN 'improving'
        ELSE 'stable'
      END as activity_trend
    FROM daily_data
  )
  SELECT jsonb_build_object(
    'period', p_period,
    'start_date', v_start_date,
    'end_date', CURRENT_DATE,
    'summary', (SELECT row_to_json(aggregates.*) FROM aggregates),
    'trends', (SELECT row_to_json(trend_calc.*) FROM trend_calc),
    'daily_data', COALESCE(
      (SELECT jsonb_agg(row_to_json(daily_data.*) ORDER BY check_in_date) FROM daily_data),
      '[]'::JSONB
    )
  ) INTO v_result;

  RETURN v_result;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_my_health_trends(p_period text, p_metric text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_my_health_trends(p_period text, p_metric text) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_my_health_trends(p_period text, p_metric text) TO authenticated;
