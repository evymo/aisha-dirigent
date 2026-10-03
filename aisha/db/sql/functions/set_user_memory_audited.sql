-- Function: public.set_user_memory_audited
-- Arguments: p_key text, p_value jsonb, p_source text DEFAULT 'inferred', p_confidence real DEFAULT 1.0, p_target_user_id uuid DEFAULT NULL
-- Security: SECURITY DEFINER
-- Source: Phase 4 — Agent Loop & Memory

CREATE OR REPLACE FUNCTION public.set_user_memory_audited(p_key text, p_value jsonb, p_source text DEFAULT 'inferred', p_confidence real DEFAULT 1.0, p_target_user_id uuid DEFAULT NULL)
 RETURNS void
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

  IF p_source NOT IN ('user_explicit', 'inferred', 'admin_set', 'agent_derived') THEN
    RAISE EXCEPTION USING MESSAGE = format('Invalid source: %s', p_source), ERRCODE = '22023';
  END IF;

  IF v_target <> v_actor_id AND p_source <> 'admin_set' THEN
    IF NOT is_admin_or_staff() THEN
      RAISE EXCEPTION 'Access denied: admin or staff required for cross-user memory write';
    END IF;
  END IF;

  INSERT INTO audit_journal (user_id, action, metadata)
  VALUES (v_actor_id, 'AI_MEMORY_WRITE', jsonb_build_object(
    'area', 'ai', 'severity', 'info',
    'target_user_id', v_target::text,
    'key', p_key, 'source', p_source,
    'confidence', p_confidence,
    'self_access', (v_target = v_actor_id)
  ));

  INSERT INTO ai_user_memory (user_id, key, value, confidence, source, last_updated)
  VALUES (v_target, p_key, p_value, p_confidence, p_source, now())
  ON CONFLICT (user_id, key)
  DO UPDATE SET value = EXCLUDED.value, confidence = EXCLUDED.confidence, source = EXCLUDED.source, last_updated = now();
END;
$$;

REVOKE ALL ON FUNCTION public.set_user_memory_audited(text, jsonb, text, real, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_user_memory_audited(text, jsonb, text, real, uuid) TO authenticated;
