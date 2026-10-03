-- Function: public.backfill_user_streaks
-- Arguments: (none)
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:25:53+01:00

CREATE OR REPLACE FUNCTION public.backfill_user_streaks()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user RECORD;
  v_updated INTEGER := 0;
  v_current_streak INTEGER;
  v_best_streak INTEGER;
  v_last_activity DATE;
BEGIN
  FOR v_user IN
    SELECT DISTINCT user_id FROM token_allocations WHERE balance > 0
  LOOP
    -- Calculate current streak
    WITH daily_activity AS (
      SELECT DISTINCT DATE(completed_at) as activity_date
      FROM reminder_completions
      WHERE user_id = v_user.user_id
      UNION
      SELECT DISTINCT check_in_date
      FROM health_check_ins
      WHERE user_id = v_user.user_id
    ),
    streak_groups AS (
      SELECT
        activity_date,
        activity_date - (ROW_NUMBER() OVER (ORDER BY activity_date) * INTERVAL '1 day')::DATE as grp
      FROM daily_activity
    ),
    streak_lengths AS (
      SELECT grp, COUNT(*) as length, MAX(activity_date) as last_date
      FROM streak_groups
      GROUP BY grp
    )
    SELECT
      COALESCE(
        (SELECT length FROM streak_lengths WHERE last_date >= CURRENT_DATE - 1 ORDER BY last_date DESC LIMIT 1),
        0
      ),
      COALESCE(MAX(length), 0),
      MAX(last_date)
    INTO v_current_streak, v_best_streak, v_last_activity
    FROM streak_lengths;

    -- Update user
    UPDATE token_allocations
    SET
      current_streak = v_current_streak,
      best_streak = v_best_streak,
      last_activity_date = v_last_activity
    WHERE user_id = v_user.user_id;

    v_updated := v_updated + 1;
  END LOOP;

  RETURN v_updated;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.backfill_user_streaks() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.backfill_user_streaks() TO authenticated;
