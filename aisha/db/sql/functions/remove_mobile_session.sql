-- Function: public.remove_mobile_session
-- Arguments: p_device_id text
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:28:00+01:00

CREATE OR REPLACE FUNCTION public.remove_mobile_session(p_device_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id UUID;
  v_deleted INTEGER;
BEGIN
  v_user_id := auth.uid();

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  DELETE FROM mobile_sessions
  WHERE user_id = v_user_id AND device_id = p_device_id;

  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  RETURN jsonb_build_object(
    'success', true,
    'deleted', v_deleted
  );
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.remove_mobile_session(p_device_id text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.remove_mobile_session(p_device_id text) TO authenticated;
