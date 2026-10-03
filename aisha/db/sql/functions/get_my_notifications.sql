-- Function: public.get_my_notifications
-- Arguments: p_limit integer, p_unread_only boolean
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:26:59+01:00

CREATE OR REPLACE FUNCTION public.get_my_notifications(p_limit integer DEFAULT 50, p_unread_only boolean DEFAULT false)
 RETURNS TABLE(id uuid, user_id uuid, type text, title text, message text, link text, is_read boolean, created_at timestamptz)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id UUID;
BEGIN
  v_user_id := auth.uid();

  IF v_user_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    n.id,
    n.user_id,
    n.type,
    n.title,
    n.message,
    n.link,
    n.is_read,
    n.created_at
  FROM notifications n
  WHERE n.user_id = v_user_id
    AND (NOT p_unread_only OR n.is_read = false)
  ORDER BY n.created_at DESC
  LIMIT p_limit;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_my_notifications(p_limit integer, p_unread_only boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_notifications(p_limit integer, p_unread_only boolean) TO authenticated;
