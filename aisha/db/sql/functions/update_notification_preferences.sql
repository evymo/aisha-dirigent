-- Function: public.update_notification_preferences
-- Arguments: p_preferences jsonb
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:28:21+01:00

CREATE OR REPLACE FUNCTION public.update_notification_preferences(p_preferences jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id UUID;
BEGIN
  v_user_id := auth.uid();

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- JIT-provision the caller: notification_preferences.user_id is NOT NULL and
  -- FKs aisha_auth.users. A Keycloak user created after the bootstrap import
  -- has a valid JWT but no aisha_auth.users row yet, so the INSERT below would
  -- fail with FK 23503. ensure_current_user() creates the registry anchor
  -- (idempotent; trigger provisions role + profile) before the write.
  PERFORM public.ensure_current_user();

  -- Upsert preferences
  INSERT INTO notification_preferences (
    user_id,
    push_enabled,
    push_reminders,
    push_health_insights,
    push_leaderboard,
    push_study_updates,
    push_achievements,
    quiet_hours_enabled,
    quiet_hours_start,
    quiet_hours_end,
    morning_start,
    afternoon_start,
    evening_start,
    questionnaire_reminder_period,
    user_timezone,
    email_weekly_summary,
    email_monthly_report,
    email_study_invitations,
    max_daily_push_notifications,
    min_notification_interval_minutes,
    updated_at
  ) VALUES (
    v_user_id,
    COALESCE((p_preferences->>'push_enabled')::BOOLEAN, true),
    COALESCE((p_preferences->>'push_reminders')::BOOLEAN, true),
    COALESCE((p_preferences->>'push_health_insights')::BOOLEAN, true),
    COALESCE((p_preferences->>'push_leaderboard')::BOOLEAN, false),
    COALESCE((p_preferences->>'push_study_updates')::BOOLEAN, true),
    COALESCE((p_preferences->>'push_achievements')::BOOLEAN, true),
    COALESCE((p_preferences->>'quiet_hours_enabled')::BOOLEAN, false),
    COALESCE((p_preferences->>'quiet_hours_start')::TIME, '22:00'),
    COALESCE((p_preferences->>'quiet_hours_end')::TIME, '07:00'),
    COALESCE((p_preferences->>'morning_start')::TIME, '09:00'),
    COALESCE((p_preferences->>'afternoon_start')::TIME, '14:00'),
    COALESCE((p_preferences->>'evening_start')::TIME, '20:00'),
    COALESCE(NULLIF(p_preferences->>'questionnaire_reminder_period', ''), 'morning'),
    COALESCE(NULLIF(p_preferences->>'user_timezone', ''), 'Europe/Prague'),
    COALESCE((p_preferences->>'email_weekly_summary')::BOOLEAN, true),
    COALESCE((p_preferences->>'email_monthly_report')::BOOLEAN, true),
    COALESCE((p_preferences->>'email_study_invitations')::BOOLEAN, true),
    COALESCE((p_preferences->>'max_daily_push_notifications')::INTEGER, 10),
    COALESCE((p_preferences->>'min_notification_interval_minutes')::INTEGER, 30),
    now()
  )
  ON CONFLICT (user_id) DO UPDATE SET
    push_enabled = COALESCE((p_preferences->>'push_enabled')::BOOLEAN, notification_preferences.push_enabled),
    push_reminders = COALESCE((p_preferences->>'push_reminders')::BOOLEAN, notification_preferences.push_reminders),
    push_health_insights = COALESCE((p_preferences->>'push_health_insights')::BOOLEAN, notification_preferences.push_health_insights),
    push_leaderboard = COALESCE((p_preferences->>'push_leaderboard')::BOOLEAN, notification_preferences.push_leaderboard),
    push_study_updates = COALESCE((p_preferences->>'push_study_updates')::BOOLEAN, notification_preferences.push_study_updates),
    push_achievements = COALESCE((p_preferences->>'push_achievements')::BOOLEAN, notification_preferences.push_achievements),
    quiet_hours_enabled = COALESCE((p_preferences->>'quiet_hours_enabled')::BOOLEAN, notification_preferences.quiet_hours_enabled),
    quiet_hours_start = COALESCE((p_preferences->>'quiet_hours_start')::TIME, notification_preferences.quiet_hours_start),
    quiet_hours_end = COALESCE((p_preferences->>'quiet_hours_end')::TIME, notification_preferences.quiet_hours_end),
    morning_start = COALESCE((p_preferences->>'morning_start')::TIME, notification_preferences.morning_start),
    afternoon_start = COALESCE((p_preferences->>'afternoon_start')::TIME, notification_preferences.afternoon_start),
    evening_start = COALESCE((p_preferences->>'evening_start')::TIME, notification_preferences.evening_start),
    questionnaire_reminder_period = COALESCE(NULLIF(p_preferences->>'questionnaire_reminder_period', ''), notification_preferences.questionnaire_reminder_period),
    user_timezone = COALESCE(NULLIF(p_preferences->>'user_timezone', ''), notification_preferences.user_timezone),
    email_weekly_summary = COALESCE((p_preferences->>'email_weekly_summary')::BOOLEAN, notification_preferences.email_weekly_summary),
    email_monthly_report = COALESCE((p_preferences->>'email_monthly_report')::BOOLEAN, notification_preferences.email_monthly_report),
    email_study_invitations = COALESCE((p_preferences->>'email_study_invitations')::BOOLEAN, notification_preferences.email_study_invitations),
    max_daily_push_notifications = COALESCE((p_preferences->>'max_daily_push_notifications')::INTEGER, notification_preferences.max_daily_push_notifications),
    min_notification_interval_minutes = COALESCE((p_preferences->>'min_notification_interval_minutes')::INTEGER, notification_preferences.min_notification_interval_minutes),
    updated_at = now();

  RETURN jsonb_build_object('success', true);
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.update_notification_preferences(p_preferences jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_notification_preferences(p_preferences jsonb) TO authenticated;
