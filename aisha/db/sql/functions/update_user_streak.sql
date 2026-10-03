-- Function: public.update_user_streak
-- Arguments: p_user_id uuid
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:28:32+01:00

CREATE OR REPLACE FUNCTION public.update_user_streak(p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_last_activity DATE;
  v_current_streak INTEGER;
  v_best_streak INTEGER;
  v_today DATE := CURRENT_DATE;
  v_new_streak INTEGER;
BEGIN
  -- Get current streak data
  SELECT last_activity_date, current_streak, best_streak
  INTO v_last_activity, v_current_streak, v_best_streak
  FROM token_allocations
  WHERE user_id = p_user_id;

  -- If no record exists, create one
  IF v_last_activity IS NULL THEN
    INSERT INTO token_allocations (user_id, balance, current_streak, best_streak, last_activity_date, updated_at)
    VALUES (p_user_id, 0, 1, 1, v_today, now())
    ON CONFLICT (user_id) DO UPDATE SET
      current_streak = 1,
      best_streak = GREATEST(token_allocations.best_streak, 1),
      last_activity_date = v_today,
      updated_at = now();

    RETURN jsonb_build_object(
      'current_streak', 1,
      'best_streak', 1,
      'streak_continued', true
    );
  END IF;

  -- Calculate new streak
  IF v_last_activity = v_today THEN
    -- Already active today, no change
    RETURN jsonb_build_object(
      'current_streak', v_current_streak,
      'best_streak', v_best_streak,
      'streak_continued', false,
      'message', 'Already active today'
    );
  ELSIF v_last_activity = v_today - 1 THEN
    -- Consecutive day - increment streak
    v_new_streak := COALESCE(v_current_streak, 0) + 1;
  ELSE
    -- Streak broken - reset to 1
    v_new_streak := 1;
  END IF;

  -- Update with new streak
  UPDATE token_allocations
  SET
    current_streak = v_new_streak,
    best_streak = GREATEST(COALESCE(best_streak, 0), v_new_streak),
    last_activity_date = v_today,
    updated_at = now()
  WHERE user_id = p_user_id;

  SELECT best_streak INTO v_best_streak
  FROM token_allocations
  WHERE user_id = p_user_id;

  RETURN jsonb_build_object(
    'current_streak', v_new_streak,
    'best_streak', v_best_streak,
    'streak_continued', v_last_activity = v_today - 1
  );
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.update_user_streak(p_user_id uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.update_user_streak(p_user_id uuid) FROM authenticated;
