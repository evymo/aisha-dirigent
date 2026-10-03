-- Function: fn_capture_learning
-- Hippocampus learning: capture a pattern→resolution mapping from a reflection run.
-- Learnings live in agent_memories with memory_type='learning', analogous to
-- the existing memory_type='personality' Psyché pattern.
-- After N reuses (tracked via access_count via fn_search_learnings), a learning
-- can be promoted to expert_rules via fn_maybe_promote_learning + WF_KB_COMPLIANCE_GATE.

CREATE OR REPLACE FUNCTION public.fn_capture_learning(
  p_run_id uuid,
  p_pattern text,
  p_resolution text,
  p_critic_scores jsonb DEFAULT '{}'::jsonb,
  p_story_id uuid DEFAULT NULL,
  p_agent_slug text DEFAULT 'aisha',
  p_embedding vector(1024) DEFAULT NULL,
  p_importance integer DEFAULT NULL,
  p_expires_in_days integer DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_id uuid;
  v_run_user_id uuid;
  v_run_kind text;
  v_content text;
  v_metadata jsonb;
  v_importance integer;
  v_expires_at timestamptz;
  v_composite_score numeric;
BEGIN
  -- Auth: authenticated user or service_role
  IF auth.uid() IS NULL AND current_setting('role', true) != 'service_role' THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_run_id IS NULL THEN
    RAISE EXCEPTION 'p_run_id is required';
  END IF;
  IF p_pattern IS NULL OR p_pattern = '' THEN
    RAISE EXCEPTION 'p_pattern is required';
  END IF;
  IF p_resolution IS NULL OR p_resolution = '' THEN
    RAISE EXCEPTION 'p_resolution is required';
  END IF;

  -- Pull run context (user_id, kind) for ownership + audit trail
  SELECT actor_user_id, kind
  INTO v_run_user_id, v_run_kind
  FROM ai_runs
  WHERE id = p_run_id;

  IF v_run_user_id IS NULL AND auth.role() != 'service_role' THEN
    RAISE EXCEPTION 'ai_run % not found or not accessible', p_run_id;
  END IF;

  -- Compose memory content: pattern → resolution as canonical form
  v_content := format('pattern: %s\nresolution: %s', p_pattern, p_resolution);

  -- Compute importance from critic scores (avg of numeric values) when not given
  IF p_importance IS NOT NULL THEN
    v_importance := LEAST(10, GREATEST(1, p_importance));
  ELSE
    SELECT COALESCE(
      ROUND(AVG((v.value)::numeric) * 10)::integer,
      5
    )
    INTO v_composite_score
    FROM jsonb_each_text(p_critic_scores) v
    WHERE v.value ~ '^[0-9]+\.?[0-9]*$';

    v_importance := LEAST(10, GREATEST(1, COALESCE(v_composite_score::integer, 5)));
  END IF;

  -- Optional expiration
  IF p_expires_in_days IS NOT NULL THEN
    v_expires_at := now() + (p_expires_in_days || ' days')::interval;
  END IF;

  -- Metadata captures the structured learning shape for later promotion logic
  v_metadata := jsonb_build_object(
    'pattern', p_pattern,
    'resolution', p_resolution,
    'critic_scores', p_critic_scores,
    'story_id', p_story_id,
    'run_kind', v_run_kind,
    'access_count', 0,
    'promoted_to_expert_rule', false,
    'captured_at', now()
  );

  INSERT INTO agent_memories (
    agent_slug,
    user_id,
    memory_type,
    content,
    importance,
    source_run_id,
    embedding,
    expires_at
  )
  VALUES (
    p_agent_slug,
    v_run_user_id,
    'learning',
    v_content || E'\n\n[meta]' || v_metadata::text,
    v_importance,
    p_run_id,
    p_embedding,
    v_expires_at
  )
  RETURNING id INTO v_id;

  -- Audit trail
  INSERT INTO audit_journal (user_id, action, metadata)
  VALUES (
    COALESCE(auth.uid(), v_run_user_id),
    'hippocampus.learning_captured',
    jsonb_build_object(
      'memory_id', v_id,
      'run_id', p_run_id,
      'story_id', p_story_id,
      'agent_slug', p_agent_slug,
      'importance', v_importance,
      'pattern_preview', LEFT(p_pattern, 100)
    )
  );

  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION public.fn_capture_learning(uuid, text, text, jsonb, uuid, text, vector, integer, integer) IS
  'Hippocampus learning: capture a pattern→resolution mapping from a reflection run. '
  'Stored as agent_memories.memory_type=learning. Importance derived from critic_scores. '
  'After repeated reuse, may be promoted to expert_rules via fn_maybe_promote_learning.';

REVOKE ALL ON FUNCTION public.fn_capture_learning(uuid, text, text, jsonb, uuid, text, vector, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_capture_learning(uuid, text, text, jsonb, uuid, text, vector, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_capture_learning(uuid, text, text, jsonb, uuid, text, vector, integer, integer) TO service_role;
