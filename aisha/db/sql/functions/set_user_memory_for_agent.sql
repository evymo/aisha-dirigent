-- Function: public.set_user_memory_for_agent
-- Arguments: p_user_id uuid, p_key text, p_value jsonb, p_source text DEFAULT 'agent_derived', p_confidence real DEFAULT 0.8
-- Security: SECURITY DEFINER
-- Source: Phase 4 — Agent Loop & Memory

CREATE OR REPLACE FUNCTION public.set_user_memory_for_agent(p_user_id uuid, p_key text, p_value jsonb, p_source text DEFAULT 'agent_derived', p_confidence real DEFAULT 0.8)
 RETURNS void
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

  INSERT INTO audit_journal (user_id, action, metadata)
  VALUES (COALESCE(v_actor_id, p_user_id), 'AI_MEMORY_WRITE', jsonb_build_object(
    'area', 'ai', 'severity', 'info',
    'target_user_id', p_user_id::text,
    'key', p_key, 'source', p_source,
    'confidence', p_confidence, 'via', 'agent'
  ));

  INSERT INTO ai_user_memory (user_id, key, value, confidence, source, last_updated)
  VALUES (p_user_id, p_key, p_value, p_confidence, p_source, now())
  ON CONFLICT (user_id, key)
  DO UPDATE SET value = EXCLUDED.value, confidence = GREATEST(ai_user_memory.confidence, EXCLUDED.confidence), source = EXCLUDED.source, last_updated = now();
END;
$$;

REVOKE ALL ON FUNCTION public.set_user_memory_for_agent(uuid, text, jsonb, text, real) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_user_memory_for_agent(uuid, text, jsonb, text, real) TO authenticated;
