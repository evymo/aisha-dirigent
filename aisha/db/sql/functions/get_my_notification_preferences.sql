-- Function: public.get_my_notification_preferences
-- Arguments: (none)
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:26:59+01:00

CREATE OR REPLACE FUNCTION public.get_my_notification_preferences()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id UUID;
  v_prefs RECORD;
BEGIN
  v_user_id := auth.uid();

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Get or create preferences
  SELECT * INTO v_prefs
  FROM notification_preferences
  WHERE user_id = v_user_id;

  IF v_prefs IS NULL THEN
    INSERT INTO notification_preferences (user_id)
    VALUES (v_user_id)
    RETURNING * INTO v_prefs;
  END IF;

  RETURN jsonb_build_object(
    'push_enabled', v_prefs.push_enabled,
    'push_reminders', v_prefs.push_reminders,
    'push_health_insights', v_prefs.push_health_insights,
    'push_leaderboard', v_prefs.push_leaderboard,
    'push_study_updates', v_prefs.push_study_updates,
    'push_achievements', v_prefs.push_achievements,
    'quiet_hours_enabled', v_prefs.quiet_hours_enabled,
    'quiet_hours_start', v_prefs.quiet_hours_start,
    'quiet_hours_end', v_prefs.quiet_hours_end,
    'morning_start', v_prefs.morning_start,
    'afternoon_start', v_prefs.afternoon_start,
    'evening_start', v_prefs.evening_start,
    'questionnaire_reminder_period', v_prefs.questionnaire_reminder_period,
    'user_timezone', v_prefs.user_timezone,
    'email_weekly_summary', v_prefs.email_weekly_summary,
    'email_monthly_report', v_prefs.email_monthly_report,
    'email_study_invitations', v_prefs.email_study_invitations,
    'max_daily_push_notifications', v_prefs.max_daily_push_notifications,
    'min_notification_interval_minutes', v_prefs.min_notification_interval_minutes
  );
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_my_notification_preferences() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_notification_preferences() TO authenticated;
