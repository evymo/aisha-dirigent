-- Function: public.get_leaderboard
-- Arguments: p_period_type text, p_limit integer
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:26:49+01:00

CREATE OR REPLACE FUNCTION public.get_leaderboard(p_period_type text DEFAULT 'weekly'::text, p_limit integer DEFAULT 100)
 RETURNS TABLE(rank integer, user_id uuid, display_name text, total_points integer, completions_count integer, streak_days integer, is_current_user boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_current_period_id UUID;
  v_current_user_id UUID;
BEGIN
  v_current_user_id := auth.uid();

  -- RATE LIMITING: 30 requests per minute
  PERFORM enforce_rate_limit('get_leaderboard', 60000, 30);

  -- Get current period (don't create - that's for cron job)
  SELECT id INTO v_current_period_id
  FROM leaderboard_periods
  WHERE period_type = p_period_type
    AND period_start <= CURRENT_DATE
    AND period_end >= CURRENT_DATE
  ORDER BY created_at DESC
  LIMIT 1;

  -- If no period exists, return empty (cron job will create it)
  IF v_current_period_id IS NULL THEN
    RETURN;
  END IF;

  -- Return leaderboard with anonymized display names
  RETURN QUERY
  SELECT
    le.rank,
    le.user_id,
    CASE
      WHEN le.user_id = v_current_user_id THEN 'You'
      ELSE 'Anonymous#' || SUBSTR(le.user_id::TEXT, 1, 4) -- Anonymize
    END as display_name,
    le.total_points,
    le.completions_count,
    le.streak_days,
    (le.user_id = v_current_user_id) as is_current_user
  FROM leaderboard_entries le
  WHERE le.period_id = v_current_period_id
    AND le.rank IS NOT NULL
  ORDER BY le.rank ASC
  LIMIT p_limit;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_leaderboard(p_period_type text, p_limit integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_leaderboard(p_period_type text, p_limit integer) TO authenticated;
