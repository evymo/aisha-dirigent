-- Function: public.get_admin_user_memories
-- Arguments: p_target_user_id uuid DEFAULT NULL, p_limit int DEFAULT 50
-- Security: SECURITY DEFINER
-- Source: Phase 4 — Agent Loop & Memory

CREATE OR REPLACE FUNCTION public.get_admin_user_memories(p_target_user_id uuid DEFAULT NULL, p_limit int DEFAULT 50)
 RETURNS TABLE(user_id uuid, key text, value jsonb, confidence real, source text, last_updated timestamptz)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT is_admin_or_staff() THEN
    RAISE EXCEPTION 'Access denied: admin or staff required';
  END IF;

  INSERT INTO audit_journal (user_id, action, metadata)
  VALUES (v_actor_id, 'AI_MEMORY_ADMIN_READ', jsonb_build_object(
    'area', 'ai', 'severity', 'info',
    'target_user_id', COALESCE(p_target_user_id::text, 'all')
  ));

  RETURN QUERY
  SELECT um.user_id, um.key, um.value, um.confidence, um.source, um.last_updated
  FROM ai_user_memory um
  WHERE (p_target_user_id IS NULL OR um.user_id = p_target_user_id)
  ORDER BY um.last_updated DESC
  LIMIT LEAST(p_limit, 200);
END;
$$;

REVOKE ALL ON FUNCTION public.get_admin_user_memories(uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_admin_user_memories(uuid, integer) TO authenticated;
