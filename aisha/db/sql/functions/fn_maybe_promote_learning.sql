-- Function: fn_maybe_promote_learning
-- Hippocampus learning: after repeated reuse, propose learning for promotion
-- to expert_rules via improvement_proposals (proposal_type='hippocampus_learning_promotion').
-- Promotion is human-gated through existing review workflow (WF_KB_COMPLIANCE_GATE
-- or similar improvement_proposals approval pipeline).

CREATE OR REPLACE FUNCTION public.fn_maybe_promote_learning(
  p_memory_id uuid,
  p_reuse_threshold integer DEFAULT 5,
  p_min_importance integer DEFAULT 6
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_memory RECORD;
  v_reuse_count integer;
  v_proposal_id uuid;
  v_proposal_existed boolean;
  v_pattern text;
  v_resolution text;
BEGIN
  -- Auth: authenticated user or service_role
  IF auth.uid() IS NULL AND current_setting('role', true) != 'service_role' THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_memory_id IS NULL THEN
    RAISE EXCEPTION 'p_memory_id is required';
  END IF;

  -- Load the learning memory
  SELECT *
  INTO v_memory
  FROM agent_memories
  WHERE id = p_memory_id
    AND memory_type = 'learning';

  IF v_memory IS NULL THEN
    RAISE EXCEPTION 'Learning memory % not found', p_memory_id;
  END IF;

  -- Skip already-promoted
  IF v_memory.content ~ '"promoted_to_expert_rule":\s*true' THEN
    RETURN jsonb_build_object(
      'memory_id', p_memory_id,
      'action', 'skipped_already_promoted',
      'proposal_id', NULL
    );
  END IF;

  -- Count reuse via audit_journal entries
  SELECT COUNT(*)::integer
  INTO v_reuse_count
  FROM audit_journal
  WHERE action = 'hippocampus.learnings_retrieved'
    AND (metadata->'memory_ids') ? p_memory_id::text;

  -- Eligibility: enough reuses + sufficient importance
  IF v_reuse_count < p_reuse_threshold THEN
    RETURN jsonb_build_object(
      'memory_id', p_memory_id,
      'action', 'below_reuse_threshold',
      'reuse_count', v_reuse_count,
      'threshold', p_reuse_threshold
    );
  END IF;

  IF v_memory.importance < p_min_importance THEN
    RETURN jsonb_build_object(
      'memory_id', p_memory_id,
      'action', 'below_importance_threshold',
      'importance', v_memory.importance,
      'threshold', p_min_importance
    );
  END IF;

  -- Check idempotency: don't double-enqueue
  SELECT EXISTS(
    SELECT 1 FROM improvement_proposals
    WHERE proposal_type = 'hippocampus_learning_promotion'
      AND (metadata->>'memory_id')::uuid = p_memory_id
      AND status IN ('draft', 'pending_review', 'approved')
  )
  INTO v_proposal_existed;

  IF v_proposal_existed THEN
    SELECT id INTO v_proposal_id
    FROM improvement_proposals
    WHERE proposal_type = 'hippocampus_learning_promotion'
      AND (metadata->>'memory_id')::uuid = p_memory_id
    ORDER BY created_at DESC
    LIMIT 1;

    RETURN jsonb_build_object(
      'memory_id', p_memory_id,
      'action', 'proposal_already_pending',
      'proposal_id', v_proposal_id
    );
  END IF;

  -- Parse pattern + resolution from content (canonical form from fn_capture_learning)
  v_pattern    := split_part(split_part(v_memory.content, 'pattern: ', 2), E'\nresolution:', 1);
  v_resolution := split_part(split_part(v_memory.content, E'resolution: ', 2), E'\n\n[meta]', 1);

  -- Enqueue promotion proposal
  INSERT INTO improvement_proposals (
    proposal_type,
    title,
    description,
    rationale,
    proposed_value,
    source,
    priority,
    agent_slug,
    category,
    risk_level,
    metadata,
    created_by,
    status
  )
  VALUES (
    'hippocampus_learning_promotion',
    format('Promote learning: %s', LEFT(v_pattern, 80)),
    format('Pattern reused %s times reaches promotion threshold.', v_reuse_count),
    format(
      'This learning was captured from reflection runs and reused %s times '
      'with importance %s/10. Promoting to expert_rules makes it available '
      'as authoritative guidance for future runs (higher decision-provenance rank).',
      v_reuse_count, v_memory.importance
    ),
    jsonb_build_object(
      'pattern', v_pattern,
      'resolution', v_resolution,
      'memory_id', p_memory_id,
      'agent_slug', v_memory.agent_slug,
      'importance', v_memory.importance
    ),
    'hippocampus',
    7,
    v_memory.agent_slug,
    'knowledge',
    'low',
    jsonb_build_object(
      'memory_id', p_memory_id,
      'source_run_id', v_memory.source_run_id,
      'reuse_count', v_reuse_count
    ),
    COALESCE(auth.uid(), v_memory.user_id),
    'pending_review'
  )
  RETURNING id INTO v_proposal_id;

  -- Audit
  INSERT INTO audit_journal (user_id, action, metadata)
  VALUES (
    auth.uid(),
    'hippocampus.learning_promotion_proposed',
    jsonb_build_object(
      'memory_id', p_memory_id,
      'proposal_id', v_proposal_id,
      'reuse_count', v_reuse_count,
      'importance', v_memory.importance
    )
  );

  RETURN jsonb_build_object(
    'memory_id', p_memory_id,
    'action', 'proposed',
    'proposal_id', v_proposal_id,
    'reuse_count', v_reuse_count,
    'importance', v_memory.importance
  );
END;
$$;

COMMENT ON FUNCTION public.fn_maybe_promote_learning(uuid, integer, integer) IS
  'Hippocampus learning: after p_reuse_threshold retrievals, propose promotion '
  'of a learning memory to expert_rules via improvement_proposals '
  '(proposal_type=hippocampus_learning_promotion). Idempotent: skips if '
  'already pending. Promotion itself is human-gated.';

REVOKE ALL ON FUNCTION public.fn_maybe_promote_learning(uuid, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_maybe_promote_learning(uuid, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_maybe_promote_learning(uuid, integer, integer) TO service_role;
