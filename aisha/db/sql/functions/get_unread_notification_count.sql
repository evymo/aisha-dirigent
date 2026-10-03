-- Function: public.get_unread_notification_count
-- Arguments: (none)
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:27:45+01:00

CREATE OR REPLACE FUNCTION public.get_unread_notification_count()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN (
    SELECT COUNT(*)::integer
    FROM notifications
    WHERE user_id = auth.uid() AND is_read = false
  );
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_unread_notification_count() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_unread_notification_count() TO authenticated;
