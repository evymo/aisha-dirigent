-- Function: public.delete_user_memory
-- Arguments: p_key text
-- Security: SECURITY DEFINER
-- Source: Phase 4 — Agent Loop & Memory

CREATE OR REPLACE FUNCTION public.delete_user_memory(p_key text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE
  v_deleted boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  DELETE FROM ai_user_memory WHERE user_id = auth.uid() AND key = p_key;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_user_memory(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_user_memory(text) TO authenticated;
