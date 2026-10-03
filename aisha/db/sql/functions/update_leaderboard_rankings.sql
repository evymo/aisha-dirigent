-- Function: public.update_leaderboard_rankings
-- Arguments: (none)
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:28:18+01:00

CREATE OR REPLACE FUNCTION public.update_leaderboard_rankings()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_period RECORD;
BEGIN
  -- Ensure periods exist first
  PERFORM ensure_leaderboard_periods();

  -- Update rankings for all active periods
  FOR v_period IN
    SELECT id, period_type, period_start, period_end
    FROM leaderboard_periods
    WHERE period_end >= CURRENT_DATE
  LOOP
    -- Use a single UPSERT operation instead of DELETE + INSERT
    WITH user_stats AS (
      SELECT
        ta.user_id,
        COALESCE(ta.balance, 0)::INTEGER as total_points,
        (
          SELECT COUNT(*)::INTEGER
          FROM reminder_completions rc
          WHERE rc.user_id = ta.user_id
            AND DATE(rc.completed_at) BETWEEN v_period.period_start AND v_period.period_end
        ) as completions_count,
        -- Calculate streak for period
        (
          WITH daily_activity AS (
            SELECT DISTINCT DATE(completed_at) as activity_date
            FROM reminder_completions
            WHERE user_id = ta.user_id
              AND DATE(completed_at) BETWEEN v_period.period_start AND LEAST(v_period.period_end, CURRENT_DATE)
            UNION
            SELECT DISTINCT check_in_date
            FROM health_check_ins
            WHERE user_id = ta.user_id
              AND check_in_date BETWEEN v_period.period_start AND LEAST(v_period.period_end, CURRENT_DATE)
          ),
          streak_groups AS (
            SELECT
              activity_date,
              activity_date - (ROW_NUMBER() OVER (ORDER BY activity_date) * INTERVAL '1 day') as grp
            FROM daily_activity
          )
          SELECT COALESCE(MAX(cnt), 0)::INTEGER
          FROM (SELECT COUNT(*) as cnt FROM streak_groups GROUP BY grp) sub
        ) as streak_days
      FROM token_allocations ta
      WHERE ta.balance > 0
    ),
    ranked_users AS (
      SELECT
        user_id,
        total_points,
        completions_count,
        streak_days,
        ROW_NUMBER() OVER (ORDER BY total_points DESC, completions_count DESC) as rank
      FROM user_stats
      WHERE total_points > 0
    )
    INSERT INTO leaderboard_entries (period_id, user_id, total_points, completions_count, streak_days, rank, updated_at)
    SELECT
      v_period.id,
      user_id,
      total_points,
      completions_count,
      streak_days,
      rank::INTEGER,
      now()
    FROM ranked_users
    ON CONFLICT (period_id, user_id) DO UPDATE SET
      total_points = EXCLUDED.total_points,
      completions_count = EXCLUDED.completions_count,
      streak_days = EXCLUDED.streak_days,
      rank = EXCLUDED.rank,
      updated_at = now();
  END LOOP;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.update_leaderboard_rankings() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_leaderboard_rankings() TO authenticated;
