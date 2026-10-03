-- Function: public.cleanup_expired_session_memory
-- Arguments: (none)
-- Security: SECURITY DEFINER
-- Source: Phase 4 — Agent Loop & Memory

CREATE OR REPLACE FUNCTION public.cleanup_expired_session_memory()
 RETURNS int
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE
  v_deleted int;
  v_actor_id uuid := auth.uid();
BEGIN
  IF v_actor_id IS NOT NULL AND NOT is_admin_or_staff() THEN
    RAISE EXCEPTION 'Access denied: admin or staff required';
  END IF;

  DELETE FROM ai_session_memory WHERE expires_at IS NOT NULL AND expires_at < now();
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

REVOKE ALL ON FUNCTION public.cleanup_expired_session_memory() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleanup_expired_session_memory() TO authenticated;
