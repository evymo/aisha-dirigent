-- Function: public.get_health_trends
-- Arguments: p_metric text, p_period text, p_start_date text, p_end_date text
-- Description: Returns health data trends aggregated by specified period for mobile app
-- Security: SECURITY DEFINER - Only authenticated users can access their own data
-- Created: 2026-01-16

CREATE OR REPLACE FUNCTION public.get_health_trends(
  p_metric TEXT,
  p_period TEXT,
  p_start_date TEXT,
  p_end_date TEXT
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id UUID;
  v_start TIMESTAMPTZ;
  v_end TIMESTAMPTZ;
  v_trends JSONB := '[]'::JSONB;
  v_interval_expr TEXT;
  v_trunc_expr TEXT;
BEGIN
  -- Get current user
  v_user_id := auth.uid();
  
  -- Fail-closed: return empty if not authenticated
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('trends', '[]'::JSONB);
  END IF;
  
  -- Validate metric
  IF p_metric NOT IN ('steps', 'heart_rate', 'sleep_hours', 'active_energy', 'distance') THEN
    RETURN jsonb_build_object('trends', '[]'::JSONB, 'error', 'Invalid metric');
  END IF;
  
  -- Validate period and set truncation
  CASE p_period
    WHEN 'daily' THEN
      v_trunc_expr := 'day';
    WHEN 'weekly' THEN
      v_trunc_expr := 'week';
    WHEN 'monthly' THEN
      v_trunc_expr := 'month';
    ELSE
      RETURN jsonb_build_object('trends', '[]'::JSONB, 'error', 'Invalid period');
  END CASE;
  
  -- Parse dates (ISO format expected)
  BEGIN
    v_start := p_start_date::TIMESTAMPTZ;
    v_end := p_end_date::TIMESTAMPTZ;
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('trends', '[]'::JSONB, 'error', 'Invalid date format');
  END;
  
  -- Build trends data
  SELECT jsonb_agg(trend_row ORDER BY period_start)
  INTO v_trends
  FROM (
    SELECT
      date_trunc(v_trunc_expr, recorded_at) AS period_start,
      date_trunc(v_trunc_expr, recorded_at) + (('1 ' || v_trunc_expr)::INTERVAL) - INTERVAL '1 second' AS period_end,
      ROUND(AVG(value)::NUMERIC, 2) AS avg_value,
      ROUND(MIN(value)::NUMERIC, 2) AS min_value,
      ROUND(MAX(value)::NUMERIC, 2) AS max_value,
      COUNT(*) AS count
    FROM health_data
    WHERE user_id = v_user_id
      AND data_type = p_metric
      AND recorded_at >= v_start
      AND recorded_at <= v_end
    GROUP BY date_trunc(v_trunc_expr, recorded_at)
  ) AS trend_row;
  
  -- Return empty array if no data
  IF v_trends IS NULL THEN
    v_trends := '[]'::JSONB;
  END IF;
  
  RETURN jsonb_build_object('trends', v_trends);

  -- Audit log
  PERFORM public.write_audit_journal(
      p_action_type := 'read'::public.journal_action_type,
      p_area := 'health'::public.journal_area,
      p_details := NULL,
      p_entity_id := NULL,
      p_entity_type := 'health_trend',
      p_new_values := NULL,
      p_old_values := NULL,
      p_severity := 'notice'::public.journal_severity,
      p_summary := 'Admin read health trend',
      p_tags := ARRAY['admin', 'health_trend'],
      p_user_id := auth.uid()
  );

END;
$function$
;

-- Permissions: sensitive data function - authenticated only, no anon access
REVOKE ALL ON FUNCTION public.get_health_trends(text, text, text, text) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_health_trends(text, text, text, text) TO authenticated;
