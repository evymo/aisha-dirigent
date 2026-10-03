-- Function: public.get_mobile_dashboard_data
-- Arguments: p_days_back integer, p_locale text
-- Description: Returns mobile dashboard data with user stats, reminders, health data, and active studies.
-- Security: SECURITY DEFINER (sensitive data)
-- Locale: p_locale parameter controls study name/description localization via translations table

CREATE OR REPLACE FUNCTION public.get_mobile_dashboard_data(
  p_days_back integer DEFAULT 7,
  p_locale text DEFAULT 'en'::text
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id UUID;
  v_result JSONB;
  v_user_stats JSONB;
  v_todays_reminders JSONB;
  v_recent_health_data JSONB;
  v_active_studies JSONB;
  v_total_points NUMERIC;
  v_weekly_points INTEGER;
  v_current_streak INTEGER;
  v_best_streak INTEGER;
  v_weekly_rank INTEGER;
BEGIN
  v_user_id := auth.uid();

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Audit log for sensitive data access
  PERFORM public.write_audit_journal(
      p_action_type := 'view',
      p_area := 'member',
      p_details := jsonb_build_object('days_back', p_days_back, 'locale', p_locale),
      p_entity_id := NULL,
      p_entity_type := 'mobile_dashboard',
      p_new_values := NULL,
      p_old_values := NULL,
      p_severity := 'notice',
      p_summary := 'Member viewing mobile dashboard data',
      p_tags := ARRAY['phi','member','mobile'],
      p_user_id := v_user_id
  );

  -- RATE LIMITING: 30 requests per minute
  PERFORM enforce_rate_limit('get_mobile_dashboard_data', 60000, 30);

  -- Get user stats including persisted streak
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

  -- Weekly rank
  SELECT rank INTO v_weekly_rank
  FROM leaderboard_entries le
  JOIN leaderboard_periods lp ON le.period_id = lp.id
  WHERE le.user_id = v_user_id
    AND lp.period_type = 'weekly'
    AND lp.period_start <= CURRENT_DATE
    AND lp.period_end >= CURRENT_DATE;

  v_user_stats := jsonb_build_object(
    'total_points', COALESCE(v_total_points, 0),
    'weekly_points', v_weekly_points,
    'current_streak', COALESCE(v_current_streak, 0),
    'best_streak', COALESCE(v_best_streak, 0),
    'weekly_rank', v_weekly_rank
  );

  -- Today's reminders with improved scheduling
  SELECT jsonb_agg(
    jsonb_build_object(
      'id', r.id,
      'title', r.title,
      'time', r.time_of_day::TEXT,
      'next_scheduled', calculate_next_reminder_time(r.id),
      'completed', EXISTS(
        SELECT 1 FROM reminder_completions rc
        WHERE rc.reminder_id = r.id
          AND DATE(rc.completed_at) = CURRENT_DATE
      ),
      'points', r.points_per_completion
    )
    ORDER BY r.time_of_day
  ) INTO v_todays_reminders
  FROM user_reminders r
  WHERE r.user_id = v_user_id
    AND r.is_active = true
    AND (
      r.frequency = 'daily'
      OR (r.frequency = 'weekly' AND EXTRACT(DOW FROM CURRENT_DATE)::INTEGER = ANY(r.custom_frequency_days))
      OR (r.frequency = 'custom' AND EXTRACT(DOW FROM CURRENT_DATE)::INTEGER = ANY(r.custom_frequency_days))
      -- Same gap as get_due_reminders_for_notification: biweekly/monthly never
      -- appeared in "today's reminders". Mirror calculate_next_reminder_time.
      OR (r.frequency = 'biweekly' AND ((CURRENT_DATE - r.start_date) % 14) = 0)
      OR (r.frequency = 'monthly' AND EXTRACT(DAY FROM CURRENT_DATE) = EXTRACT(DAY FROM r.start_date))
    );

  -- Recent health data (optimized with pre-calculated averages)
  WITH recent_data AS (
    SELECT
      steps_count,
      sleep_hours,
      heart_rate_avg,
      energy_level,
      mood_level,
      pain_level
    FROM health_check_ins
    WHERE user_id = v_user_id
      AND check_in_date >= CURRENT_DATE - p_days_back
  ),
  averages AS (
    SELECT
      AVG(steps_count)::INTEGER as avg_steps,
      ROUND(AVG(sleep_hours)::NUMERIC, 1) as avg_sleep,
      AVG(heart_rate_avg)::INTEGER as avg_heart_rate,
      ROUND(AVG(energy_level)::NUMERIC, 1) as avg_energy,
      ROUND(AVG(mood_level)::NUMERIC, 1) as avg_mood,
      ROUND(AVG(pain_level)::NUMERIC, 1) as avg_pain
    FROM recent_data
  )
  SELECT jsonb_build_object(
    'avg_steps_7d', COALESCE(avg_steps, 0),
    'avg_sleep_7d', COALESCE(avg_sleep, 0),
    'avg_heart_rate_7d', COALESCE(avg_heart_rate, 0),
    'avg_energy_7d', COALESCE(avg_energy, 0),
    'avg_mood_7d', COALESCE(avg_mood, 0),
    'avg_pain_7d', COALESCE(avg_pain, 0),
    'trend', CASE
      WHEN avg_energy > 7 THEN 'improving'
      WHEN avg_energy >= 5 THEN 'stable'
      ELSE 'declining'
    END
  ) INTO v_recent_health_data
  FROM averages;

  -- Active studies with pending questionnaires (optimized, localized)
  WITH pending_q AS (
    SELECT
      se.id as registration_id,
      COUNT(q.id) FILTER (
        WHERE NOT EXISTS (
          SELECT 1 FROM questionnaire_responses qr
          WHERE qr.questionnaire_id = q.id
            AND qr.user_id = v_user_id
            AND qr.study_registration_id = se.id
            AND qr.completed_at >= CURRENT_DATE - INTERVAL '7 days'
        )
      )::INTEGER as pending_count
    FROM study_registrations se
    CROSS JOIN questionnaires q
    WHERE se.user_id = v_user_id
      AND se.status IN ('enrolled', 'active')
      AND q.is_active = true
    GROUP BY se.id
  )
  SELECT jsonb_agg(
    jsonb_build_object(
      'id', s.id,
      'title', COALESCE(
        (SELECT t.value FROM translations t WHERE t.key = s.name_key AND t.locale = p_locale AND t.namespace = 'studies' LIMIT 1),
        (SELECT t.value FROM translations t WHERE t.key = s.name_key AND t.locale = 'en' AND t.namespace = 'studies' LIMIT 1),
        s.name
      ),
      'registration_status', se.status,
      'pending_questionnaires', COALESCE(pq.pending_count, 0)
    )
  ) INTO v_active_studies
  FROM study_registrations se
  JOIN studies s ON se.study_id = s.id
  LEFT JOIN pending_q pq ON pq.registration_id = se.id
  WHERE se.user_id = v_user_id
    AND se.status IN ('enrolled', 'active');

  -- Build final result
  v_result := jsonb_build_object(
    'user_stats', v_user_stats,
    'todays_reminders', COALESCE(v_todays_reminders, '[]'::JSONB),
    'recent_health_data', COALESCE(v_recent_health_data, '{}'::JSONB),
    'active_studies', COALESCE(v_active_studies, '[]'::JSONB)
  );

  RETURN v_result;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_mobile_dashboard_data(p_days_back integer, p_locale text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_mobile_dashboard_data(p_days_back integer, p_locale text) TO authenticated;
