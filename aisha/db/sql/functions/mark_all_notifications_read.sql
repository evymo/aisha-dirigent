-- Function: public.mark_all_notifications_read
-- Arguments: (none)
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:27:56+01:00

CREATE OR REPLACE FUNCTION public.mark_all_notifications_read()
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id UUID;
  v_count INTEGER;
BEGIN
  v_user_id := auth.uid();

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  UPDATE notifications
  SET is_read = true
  WHERE user_id = v_user_id
    AND is_read = false;

  GET DIAGNOSTICS v_count = ROW_COUNT;

  RETURN json_build_object('success', true, 'count', v_count);
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.mark_all_notifications_read() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_all_notifications_read() TO authenticated;
