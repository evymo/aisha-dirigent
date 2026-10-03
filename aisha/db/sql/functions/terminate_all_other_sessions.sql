-- Function: public.terminate_all_other_sessions
-- Arguments: p_current_session_id uuid DEFAULT NULL
-- Description: Terminates all other sessions for the current user. 
--              If p_current_session_id is NULL, keeps only the most recent session.
-- Security: SECURITY DEFINER
-- Updated: 2026-01-09 - Made p_current_session_id optional

CREATE OR REPLACE FUNCTION public.terminate_all_other_sessions(
  p_current_session_id uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_keep_session_id uuid;
BEGIN
  -- If no session ID provided, find the most recent one
  IF p_current_session_id IS NULL THEN
    SELECT id INTO v_keep_session_id
    FROM user_sessions
    WHERE user_id = auth.uid()
    ORDER BY last_activity_at DESC NULLS LAST, created_at DESC
    LIMIT 1;
  ELSE
    v_keep_session_id := p_current_session_id;
  END IF;

  -- Delete all other sessions
  IF v_keep_session_id IS NOT NULL THEN
    DELETE FROM user_sessions 
    WHERE user_id = auth.uid() 
    AND id != v_keep_session_id;
  END IF;
END;
$function$;

-- Permissions
REVOKE ALL ON FUNCTION public.terminate_all_other_sessions(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.terminate_all_other_sessions(uuid) TO authenticated;
