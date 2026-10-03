-- Function: public.get_user_memory_for_agent
-- Arguments: p_user_id uuid
-- Security: SECURITY DEFINER
-- Source: Phase 4 — Agent Loop & Memory

CREATE OR REPLACE FUNCTION public.get_user_memory_for_agent(p_user_id uuid)
 RETURNS TABLE(key text, value jsonb, confidence real, source text, last_updated timestamptz)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
BEGIN
  IF v_actor_id IS NOT NULL AND NOT is_admin_or_staff() THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  RETURN QUERY
  SELECT um.key, um.value, um.confidence, um.source, um.last_updated
  FROM ai_user_memory um
  WHERE um.user_id = p_user_id
  ORDER BY um.confidence DESC, um.last_updated DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_user_memory_for_agent(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_user_memory_for_agent(uuid) TO authenticated;
