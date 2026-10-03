-- Function: public.mark_notification_read
-- Arguments: p_notification_id uuid
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:27:57+01:00

CREATE OR REPLACE FUNCTION public.mark_notification_read(p_notification_id uuid)
 RETURNS json
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

  UPDATE notifications
  SET is_read = true
  WHERE id = p_notification_id
    AND user_id = v_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Notification not found or access denied';
  END IF;

  RETURN json_build_object('success', true);
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.mark_notification_read(p_notification_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_notification_read(p_notification_id uuid) TO authenticated;
