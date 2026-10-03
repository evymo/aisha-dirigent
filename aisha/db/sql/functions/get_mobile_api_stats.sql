-- Function: public.get_mobile_api_stats
-- Arguments: p_days_back integer
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:26:50+01:00

CREATE OR REPLACE FUNCTION public.get_mobile_api_stats(p_days_back integer DEFAULT 7)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id UUID;
  v_result JSONB;
BEGIN
  v_user_id := auth.uid();

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Check if user is admin
  IF NOT EXISTS (
    SELECT 1 FROM user_roles ur
    JOIN roles r ON ur.role_id = r.id
    WHERE ur.user_id = v_user_id AND r.name = 'admin'
  ) THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  -- Audit log for admin sensitive data access
  PERFORM public.write_audit_journal(
      p_action_type := 'view',
      p_area := 'admin',
      p_details := jsonb_build_object('days_back', p_days_back),
      p_entity_id := NULL,
      p_entity_type := 'health_data_sync_log',
      p_new_values := NULL,
      p_old_values := NULL,
      p_severity := 'notice',
      p_summary := 'Admin viewing mobile API stats',
      p_tags := ARRAY['phi','admin','mobile'],
      p_user_id := v_user_id
  );

  WITH date_range AS (
    SELECT generate_series(
      CURRENT_DATE - p_days_back,
      CURRENT_DATE,
      '1 day'::INTERVAL
    )::DATE as date
  ),
  daily_syncs AS (
    SELECT
      DATE(sync_started_at) as date,
      COUNT(*) as sync_count,
      SUM(inserted_count) as records_inserted,
      SUM(skipped_count) as records_skipped,
      SUM(error_count) as records_failed,
      COUNT(DISTINCT user_id) as unique_users,
      ROUND(AVG(duration_ms)::NUMERIC, 2) as avg_duration_ms
    FROM health_data_sync_log
    WHERE sync_started_at >= CURRENT_DATE - p_days_back
    GROUP BY DATE(sync_started_at)
  ),
  daily_completions AS (
    SELECT
      DATE(completed_at) as date,
      COUNT(*) as completion_count,
      SUM(points_awarded) as points_awarded,
      COUNT(DISTINCT user_id) as unique_users
    FROM reminder_completions
    WHERE completed_at >= CURRENT_DATE - p_days_back
    GROUP BY DATE(completed_at)
  ),
  active_sessions AS (
    SELECT
      device_platform,
      COUNT(*) as session_count,
      COUNT(*) FILTER (WHERE last_active_at >= CURRENT_DATE - 1) as active_24h,
      COUNT(*) FILTER (WHERE last_active_at >= CURRENT_DATE - 7) as active_7d
    FROM mobile_sessions
    GROUP BY device_platform
  ),
  rate_limit_stats AS (
    SELECT
      endpoint,
      COUNT(*) as total_requests,
      SUM(request_count) as total_count
    FROM api_rate_limits
    WHERE created_at >= CURRENT_DATE - p_days_back
    GROUP BY endpoint
    ORDER BY total_count DESC
    LIMIT 10
  )
  SELECT jsonb_build_object(
    'period_days', p_days_back,
    'health_syncs', (
      SELECT jsonb_agg(jsonb_build_object(
        'date', dr.date,
        'syncs', COALESCE(ds.sync_count, 0),
        'records', COALESCE(ds.records_inserted, 0),
        'users', COALESCE(ds.unique_users, 0),
        'avg_duration_ms', COALESCE(ds.avg_duration_ms, 0)
      ) ORDER BY dr.date)
      FROM date_range dr
      LEFT JOIN daily_syncs ds ON ds.date = dr.date
    ),
    'reminder_completions', (
      SELECT jsonb_agg(jsonb_build_object(
        'date', dr.date,
        'completions', COALESCE(dc.completion_count, 0),
        'points', COALESCE(dc.points_awarded, 0),
        'users', COALESCE(dc.unique_users, 0)
      ) ORDER BY dr.date)
      FROM date_range dr
      LEFT JOIN daily_completions dc ON dc.date = dr.date
    ),
    'active_sessions', (
      SELECT jsonb_agg(row_to_json(active_sessions.*))
      FROM active_sessions
    ),
    'top_endpoints', (
      SELECT jsonb_agg(row_to_json(rate_limit_stats.*))
      FROM rate_limit_stats
    ),
    'totals', jsonb_build_object(
      'total_mobile_sessions', (SELECT COUNT(*) FROM mobile_sessions),
      'total_health_records', (SELECT COUNT(*) FROM health_check_ins WHERE synced_at IS NOT NULL),
      'total_reminder_completions', (SELECT COUNT(*) FROM reminder_completions),
      'total_points_awarded', (SELECT SUM(points_awarded) FROM reminder_completions),
      'users_with_streaks', (SELECT COUNT(*) FROM token_allocations WHERE current_streak > 0)
    )
  ) INTO v_result;

  RETURN v_result;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_mobile_api_stats(p_days_back integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_mobile_api_stats(p_days_back integer) TO authenticated;
