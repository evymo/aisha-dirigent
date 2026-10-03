-- Function: get_member_diary_calendar_audited
-- Returns calendar view with health/product data for a month
-- Security: DEFINER with audit trail
-- Created: 2026-01-17

CREATE OR REPLACE FUNCTION public.get_member_diary_calendar_audited(p_month date)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
  v_start_date date;
  v_end_date date;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  v_start_date := date_trunc('month', p_month)::date;
  v_end_date := (date_trunc('month', p_month) + interval '1 month' - interval '1 day')::date;

  INSERT INTO audit_journal (user_id, action_type, entity_type, area, severity, summary)
  VALUES (auth.uid(), 'read', 'member_diary_calendar', 'member', 'info', 
          format('Member viewed calendar for %s', to_char(p_month, 'YYYY-MM')));

  SELECT jsonb_build_object(
    'month', to_char(p_month, 'YYYY-MM'),
    'days', COALESCE((
      SELECT jsonb_agg(day_data ORDER BY (day_data->>'date'))
      FROM (
        SELECT jsonb_build_object(
          'date', d::date,
          'products_taken', COALESCE((
            SELECT COUNT(*)::int FROM member_product_logs msl 
            WHERE msl.user_id = auth.uid() AND msl.logged_at::date = d::date
          ), 0),
          'states_logged', COALESCE((
            SELECT COUNT(*)::int FROM member_health_logs mhl 
            WHERE mhl.user_id = auth.uid() AND mhl.logged_at::date = d::date
          ), 0),
          'has_active_issues', EXISTS(
            SELECT 1 FROM member_health_logs mhl 
            WHERE mhl.user_id = auth.uid() 
              AND mhl.started_at::date <= d::date 
              AND (mhl.ended_at IS NULL OR mhl.ended_at::date >= d::date)
              AND mhl.severity >= 3
          ),
          'distribution_received', EXISTS(
            SELECT 1 FROM user_distribution_schedule uds
            WHERE uds.user_id = auth.uid()
              AND uds.delivered_at::date = d::date
          )
        ) as day_data
        FROM generate_series(v_start_date, v_end_date, '1 day'::interval) d
      ) days
    ), '[]'::jsonb),
    'distributions', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'date', uds.scheduled_date,
        'status', uds.status,
        'vial_count', uds.vial_count,
        'tracking_number', uds.tracking_number,
        'carrier', uds.carrier,
        'shipped_at', uds.shipped_at,
        'delivered_at', uds.delivered_at
      ))
      FROM user_distribution_schedule uds
      WHERE uds.user_id = auth.uid()
        AND uds.scheduled_date BETWEEN v_start_date AND v_end_date
    ), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

-- Permissions
REVOKE ALL ON FUNCTION public.get_member_diary_calendar_audited(date) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_member_diary_calendar_audited(date) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_member_diary_calendar_audited(date) TO authenticated;

COMMENT ON FUNCTION public.get_member_diary_calendar_audited(date) IS 
'Returns calendar view with product/health data for a given month. Audited.';
