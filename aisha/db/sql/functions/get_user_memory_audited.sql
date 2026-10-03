-- Function: public.get_user_memory_audited
-- Arguments: p_target_user_id uuid DEFAULT NULL
-- Security: SECURITY DEFINER
-- Source: Phase 4 — Agent Loop & Memory

CREATE OR REPLACE FUNCTION public.get_user_memory_audited(p_target_user_id uuid DEFAULT NULL)
 RETURNS TABLE(key text, value jsonb, confidence real, source text, last_updated timestamptz)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_target   uuid := COALESCE(p_target_user_id, v_actor_id);
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF v_target <> v_actor_id THEN
    IF NOT is_admin_or_staff() THEN
      RAISE EXCEPTION 'Access denied: admin or staff required for cross-user memory access';
    END IF;
  END IF;

  INSERT INTO audit_journal (user_id, action, metadata)
  VALUES (v_actor_id, 'AI_MEMORY_READ', jsonb_build_object(
    'area', 'ai', 'severity', 'info',
    'target_user_id', v_target::text,
    'self_access', (v_target = v_actor_id)
  ));

  RETURN QUERY
  SELECT um.key, um.value, um.confidence, um.source, um.last_updated
  FROM ai_user_memory um
  WHERE um.user_id = v_target
  ORDER BY um.last_updated DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_user_memory_audited(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_user_memory_audited(uuid) TO authenticated;
