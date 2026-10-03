-- Function: public.get_active_reminders
-- Arguments: (none)
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:26:30+01:00

CREATE OR REPLACE FUNCTION public.get_active_reminders()
 RETURNS TABLE(id uuid, reminder_type text, title text, description text, scheduled_time time without time zone, days_of_week int4[], notification_enabled boolean, study_registration_id uuid, metadata jsonb)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  SELECT 
    r.id,
    r.reminder_type,
    r.title,
    r.description,
    r.scheduled_time,
    r.days_of_week,
    r.notification_enabled,
    r.study_registration_id,
    r.metadata
  FROM user_reminders r
  WHERE r.user_id = auth.uid()
    AND r.is_active = true
  ORDER BY r.scheduled_time;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_active_reminders() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_active_reminders() TO authenticated;
