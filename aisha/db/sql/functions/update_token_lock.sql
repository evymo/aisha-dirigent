-- Function: public.update_token_lock
-- Arguments: p_lock_id uuid, p_unlock boolean
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:28:31+01:00

CREATE OR REPLACE FUNCTION public.update_token_lock(p_lock_id uuid, p_unlock boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authenticated');
  END IF;

  IF p_unlock THEN
    UPDATE token_locks
    SET unlocked_at = now()
    WHERE id = p_lock_id AND user_id = auth.uid();
  END IF;

  RETURN jsonb_build_object('success', true);
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.update_token_lock(p_lock_id uuid, p_unlock boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_token_lock(p_lock_id uuid, p_unlock boolean) TO authenticated;
