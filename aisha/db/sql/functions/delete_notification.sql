-- Function: public.delete_notification
-- Arguments: p_notification_id uuid
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:26:22+01:00

CREATE OR REPLACE FUNCTION public.delete_notification(p_notification_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id UUID;
  v_was_unread BOOLEAN;
BEGIN
  v_user_id := auth.uid();

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT NOT is_read INTO v_was_unread
  FROM notifications
  WHERE id = p_notification_id AND user_id = v_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Notification not found or access denied';
  END IF;

  DELETE FROM notifications
  WHERE id = p_notification_id AND user_id = v_user_id;

  RETURN json_build_object('success', true, 'was_unread', COALESCE(v_was_unread, false));
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.delete_notification(p_notification_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_notification(p_notification_id uuid) TO authenticated;
