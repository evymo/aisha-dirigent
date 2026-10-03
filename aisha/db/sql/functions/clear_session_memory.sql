-- Function: public.clear_session_memory
-- Arguments: p_conversation_id uuid
-- Security: SECURITY DEFINER
-- Source: Phase 4 — Agent Loop & Memory

CREATE OR REPLACE FUNCTION public.clear_session_memory(p_conversation_id uuid)
 RETURNS int
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE
  v_deleted int;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  DELETE FROM ai_session_memory
  WHERE conversation_id = p_conversation_id AND user_id = auth.uid();

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

REVOKE ALL ON FUNCTION public.clear_session_memory(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.clear_session_memory(uuid) TO authenticated;
