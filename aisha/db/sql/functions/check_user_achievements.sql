-- Function: public.check_user_achievements
-- Arguments: p_user_id uuid
-- Description: Checks all achievements and awards any that user has qualified for.
--              Supports all requirement types: checkin_count, questionnaire_count,
--              product_log_count, streak_days, study_registration_count, total_tokens,
--              profile_completion, special.
-- Security: SECURITY DEFINER - creates token_allocation if missing.
-- Updated: 2026-02-03

CREATE OR REPLACE FUNCTION public.check_user_achievements(p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_achievement RECORD;
  v_user_stats RECORD;
  v_new_achievements JSONB := '[]'::JSONB;
  v_points_awarded INTEGER := 0;
  v_profile_completion INTEGER := 0;
BEGIN
  -- Authorization: caller must be the user themselves or a system/trigger context
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_user_id THEN
    RAISE EXCEPTION 'Not authorized to check achievements for another user';
  END IF;

  -- Ensure user has token_allocation record
  INSERT INTO token_allocations (user_id, allocation_type, token_type, balance, current_streak, best_streak)
  VALUES (p_user_id, 'user', 'platform', 0, 0, 0)
  ON CONFLICT (user_id) DO NOTHING;

  -- Calculate profile completion percentage
  SELECT CASE
    WHEN p.id IS NULL THEN 0
    ELSE (
      (CASE WHEN p.display_name IS NOT NULL AND p.display_name != '' THEN 20 ELSE 0 END) +
      (CASE WHEN p.date_of_birth IS NOT NULL THEN 20 ELSE 0 END) +
      (CASE WHEN p.gender IS NOT NULL THEN 20 ELSE 0 END) +
      (CASE WHEN p.avatar_url IS NOT NULL AND p.avatar_url != '' THEN 20 ELSE 0 END) +
      (CASE WHEN p.primary_diagnosis IS NOT NULL THEN 20 ELSE 0 END)
    )
  END INTO v_profile_completion
  FROM profiles p
  WHERE p.user_id = p_user_id;

  -- Get user stats for all requirement types
  SELECT
    COALESCE(ta.balance, 0) as total_tokens,
    COALESCE(ta.current_streak, 0) as current_streak,
    COALESCE(ta.best_streak, 0) as best_streak,
    (SELECT COUNT(*) FROM health_check_ins WHERE user_id = p_user_id) as checkin_count,
    (SELECT COUNT(DISTINCT questionnaire_id) FROM questionnaire_responses WHERE user_id = p_user_id) as questionnaire_count,
    (SELECT COUNT(*) FROM dosing_logs WHERE user_id = p_user_id) as product_log_count,
    (SELECT COUNT(*) FROM study_registrations WHERE user_id = p_user_id AND status IN ('enrolled', 'active', 'completed')) as study_registration_count,
    v_profile_completion as profile_completion,
    -- Special achievements: early_adopter if user registered in first month
    CASE WHEN EXISTS (
      SELECT 1 FROM aisha_auth.users u 
      WHERE u.id = p_user_id 
      AND u.created_at < '2026-02-01'::timestamptz
    ) THEN 1 ELSE 0 END as is_early_adopter
  INTO v_user_stats
  FROM token_allocations ta
  WHERE ta.user_id = p_user_id;

  -- Check each achievement
  FOR v_achievement IN
    SELECT a.*
    FROM achievements a
    WHERE a.is_active = true
      AND NOT EXISTS (
        SELECT 1 FROM user_achievements ua
        WHERE ua.user_id = p_user_id AND ua.achievement_id = a.id
      )
  LOOP
    -- Check if requirement is met based on requirement_type
    IF (
      (v_achievement.requirement_type = 'checkin_count' AND v_user_stats.checkin_count >= v_achievement.requirement_value) OR
      (v_achievement.requirement_type = 'questionnaire_count' AND v_user_stats.questionnaire_count >= v_achievement.requirement_value) OR
      (v_achievement.requirement_type = 'product_log_count' AND v_user_stats.product_log_count >= v_achievement.requirement_value) OR
      (v_achievement.requirement_type = 'streak_days' AND v_user_stats.current_streak >= v_achievement.requirement_value) OR
      (v_achievement.requirement_type = 'study_registration_count' AND v_user_stats.study_registration_count >= v_achievement.requirement_value) OR
      (v_achievement.requirement_type = 'total_tokens' AND v_user_stats.total_tokens >= v_achievement.requirement_value) OR
      (v_achievement.requirement_type = 'profile_completion' AND v_user_stats.profile_completion >= v_achievement.requirement_value) OR
      (v_achievement.requirement_type = 'special' AND v_achievement.code = 'early_adopter' AND v_user_stats.is_early_adopter = 1)
    ) THEN
      -- Award achievement
      INSERT INTO user_achievements (user_id, achievement_id)
      VALUES (p_user_id, v_achievement.id)
      ON CONFLICT DO NOTHING;

      -- Award points
      IF v_achievement.points_reward > 0 THEN
        UPDATE token_allocations
        SET balance = balance + v_achievement.points_reward, updated_at = now()
        WHERE user_id = p_user_id;

        INSERT INTO token_transactions (
          to_user_id, amount, transaction_type, reference_type, reference_id,
          description, created_at
        ) VALUES (
          p_user_id, v_achievement.points_reward, 'reward', 'achievement', v_achievement.id,
          format('Achievement unlocked: %s', v_achievement.code), now()
        );

        v_points_awarded := v_points_awarded + v_achievement.points_reward;
      END IF;

      v_new_achievements := v_new_achievements || jsonb_build_object(
        'id', v_achievement.id,
        'code', v_achievement.code,
        'title', v_achievement.title,
        'points', v_achievement.points_reward
      );
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'new_achievements', v_new_achievements,
    'points_awarded', v_points_awarded
  );
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.check_user_achievements(p_user_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_user_achievements(p_user_id uuid) TO authenticated;
