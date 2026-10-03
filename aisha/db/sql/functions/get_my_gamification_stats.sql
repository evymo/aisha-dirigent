-- Function: public.get_my_gamification_stats
-- Arguments: (none)
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:26:56+01:00

CREATE OR REPLACE FUNCTION public.get_my_gamification_stats()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id UUID;
  v_total_points NUMERIC;
  v_weekly_points INTEGER;
  v_monthly_points INTEGER;
  v_current_streak INTEGER;
  v_best_streak INTEGER;
  v_weekly_rank INTEGER;
  v_monthly_rank INTEGER;
  v_total_completions INTEGER;
  v_total_check_ins INTEGER;
BEGIN
  v_user_id := auth.uid();

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Audit log for sensitive data access (includes health_check_ins count)
  PERFORM public.write_audit_journal(
      p_action_type := 'view',
      p_area := 'member',
      p_details := NULL,
      p_entity_id := NULL,
      p_entity_type := 'gamification_stats',
      p_new_values := NULL,
      p_old_values := NULL,
      p_severity := 'notice',
      p_summary := 'Member viewing gamification stats',
      p_tags := ARRAY['phi','member','gamification'],
      p_user_id := v_user_id
  );

  -- RATE LIMITING: 30 requests per minute
  PERFORM enforce_rate_limit('get_my_gamification_stats', 60000, 30);

  -- Get all stats from token_allocations (including persisted streak)
  SELECT
    COALESCE(balance, 0),
    COALESCE(current_streak, 0),
    COALESCE(best_streak, 0)
  INTO v_total_points, v_current_streak, v_best_streak
  FROM token_allocations
  WHERE user_id = v_user_id;

  -- Weekly points
  SELECT COALESCE(SUM(amount), 0)::INTEGER INTO v_weekly_points
  FROM token_transactions
  WHERE to_user_id = v_user_id
    AND created_at >= date_trunc('week', CURRENT_DATE);

  -- Monthly points
  SELECT COALESCE(SUM(amount), 0)::INTEGER INTO v_monthly_points
  FROM token_transactions
  WHERE to_user_id = v_user_id
    AND created_at >= date_trunc('month', CURRENT_DATE);

  -- Weekly rank
  SELECT rank INTO v_weekly_rank
  FROM leaderboard_entries le
  JOIN leaderboard_periods lp ON le.period_id = lp.id
  WHERE le.user_id = v_user_id
    AND lp.period_type = 'weekly'
    AND lp.period_start <= CURRENT_DATE
    AND lp.period_end >= CURRENT_DATE;

  -- Monthly rank
  SELECT rank INTO v_monthly_rank
  FROM leaderboard_entries le
  JOIN leaderboard_periods lp ON le.period_id = lp.id
  WHERE le.user_id = v_user_id
    AND lp.period_type = 'monthly'
    AND lp.period_start <= CURRENT_DATE
    AND lp.period_end >= CURRENT_DATE;

  -- Total completions
  SELECT COUNT(*)::INTEGER INTO v_total_completions
  FROM reminder_completions
  WHERE user_id = v_user_id;

  -- Total check-ins
  SELECT COUNT(*)::INTEGER INTO v_total_check_ins
  FROM health_check_ins
  WHERE user_id = v_user_id;

  RETURN jsonb_build_object(
    'total_points', COALESCE(v_total_points, 0),
    'weekly_points', v_weekly_points,
    'monthly_points', v_monthly_points,
    'current_streak', COALESCE(v_current_streak, 0),
    'best_streak', COALESCE(v_best_streak, 0),
    'weekly_rank', v_weekly_rank,
    'monthly_rank', v_monthly_rank,
    'total_completions', v_total_completions,
    'total_check_ins', v_total_check_ins
  );
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_my_gamification_stats() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_gamification_stats() TO authenticated;
