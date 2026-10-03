-- Function: public.get_my_active_reminders
-- Arguments: (none)
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:26:51+01:00

CREATE OR REPLACE FUNCTION public.get_my_active_reminders()
 RETURNS TABLE(id uuid, title text, description text, reminder_type text, frequency text, custom_frequency_days int4[], time_of_day time without time zone, quick_question text, quick_response_type text, points_per_completion integer, next_scheduled_time timestamp with time zone, completions_this_week integer, last_completed_at timestamp with time zone, user_timezone text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- RATE LIMITING: 20 requests per minute
  PERFORM enforce_rate_limit('get_my_active_reminders', 60000, 20);

  RETURN QUERY
  SELECT
    r.id,
    r.title,
    r.description,
    r.reminder_type,
    r.frequency,
    r.custom_frequency_days,
    r.time_of_day,
    r.quick_question,
    r.quick_response_type,
    r.points_per_completion,
    -- Use improved scheduling calculation
    calculate_next_reminder_time(r.id) as next_scheduled_time,
    -- Count this week's completions
    (
      SELECT COUNT(*)::INTEGER
      FROM reminder_completions rc
      WHERE rc.reminder_id = r.id
        AND rc.completed_at >= date_trunc('week', CURRENT_DATE)
    ) as completions_this_week,
    -- Last completion
    (
      SELECT MAX(completed_at)
      FROM reminder_completions rc
      WHERE rc.reminder_id = r.id
    ) as last_completed_at,
    r.user_timezone
  FROM user_reminders r
  WHERE r.user_id = auth.uid()
    AND r.is_active = true
    AND (r.end_date IS NULL OR r.end_date >= CURRENT_DATE)
  ORDER BY calculate_next_reminder_time(r.id);
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_my_active_reminders() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_active_reminders() TO authenticated;
