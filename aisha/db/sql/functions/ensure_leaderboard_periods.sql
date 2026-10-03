-- Function: public.ensure_leaderboard_periods
-- Arguments: (none)
-- Description: Helper function to ensure leaderboard periods exist.
-- Security: Internal helper - called by scheduled jobs.
-- @internal: true

CREATE OR REPLACE FUNCTION public.ensure_leaderboard_periods()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_week_start DATE;
  v_week_end DATE;
  v_month_start DATE;
  v_month_end DATE;
BEGIN
  v_week_start := date_trunc('week', CURRENT_DATE)::DATE;
  v_week_end := (date_trunc('week', CURRENT_DATE) + INTERVAL '6 days')::DATE;
  v_month_start := date_trunc('month', CURRENT_DATE)::DATE;
  v_month_end := (date_trunc('month', CURRENT_DATE) + INTERVAL '1 month - 1 day')::DATE;

  INSERT INTO leaderboard_periods (period_type, period_start, period_end)
  VALUES ('weekly', v_week_start, v_week_end)
  ON CONFLICT (period_type, period_start, period_end) DO NOTHING;

  INSERT INTO leaderboard_periods (period_type, period_start, period_end)
  VALUES ('monthly', v_month_start, v_month_end)
  ON CONFLICT (period_type, period_start, period_end) DO NOTHING;

  INSERT INTO leaderboard_periods (period_type, period_start, period_end)
  VALUES ('all_time', '2020-01-01'::DATE, '2099-12-31'::DATE)
  ON CONFLICT (period_type, period_start, period_end) DO NOTHING;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.ensure_leaderboard_periods() FROM PUBLIC;
-- No GRANT - internal/helper function
