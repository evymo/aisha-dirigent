-- Function: fn_search_learnings
-- Hippocampus learning: retrieve relevant learnings via vector similarity.
-- Scoped by story_id (or global when NULL). Increments access_count for
-- promotion threshold tracking. Analogous to fn_search_personality_context but
-- targets memory_type='learning'.

CREATE OR REPLACE FUNCTION public.fn_search_learnings(
  p_query_embedding vector(1024),
  p_story_id uuid DEFAULT NULL,
  p_agent_slug text DEFAULT 'aisha',
  p_limit integer DEFAULT 5,
  p_min_importance integer DEFAULT 3
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_results jsonb;
  v_ids uuid[];
BEGIN
  -- Auth: authenticated user or service_role
  IF auth.uid() IS NULL AND current_setting('role', true) != 'service_role' THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_query_embedding IS NULL THEN
    RAISE EXCEPTION 'p_query_embedding is required';
  END IF;

  -- Top-K retrieval by cosine + importance compound score
  SELECT
    COALESCE(jsonb_agg(sub.obj ORDER BY sub.score DESC), '[]'::jsonb),
    array_agg(sub.id ORDER BY sub.score DESC)
  INTO v_results, v_ids
  FROM (
    SELECT
      am.id,
      jsonb_build_object(
        'memory_id', am.id,
        'source_run_id', am.source_run_id,
        'content', am.content,
        'importance', am.importance,
        'created_at', am.created_at,
        'score', round((
          (1 - (am.embedding <=> p_query_embedding)) * 0.6
          + (am.importance / 10.0) * 0.4
        )::numeric, 4)
      ) AS obj,
      (1 - (am.embedding <=> p_query_embedding)) * 0.6
        + (am.importance / 10.0) * 0.4 AS score
    FROM agent_memories am
    LEFT JOIN ai_runs r ON r.id = am.source_run_id
    WHERE am.memory_type = 'learning'
      AND am.agent_slug = p_agent_slug
      AND am.embedding IS NOT NULL
      AND am.importance >= p_min_importance
      AND (am.expires_at IS NULL OR am.expires_at > now())
      AND (
        p_story_id IS NULL
        OR r.story_id = p_story_id
        OR r.story_id IS NULL  -- global learnings always included
      )
    ORDER BY score DESC
    LIMIT p_limit
  ) sub;

  -- Increment access_count for promotion threshold tracking
  -- (access_count lives in updated_at touch; we capture via audit_journal too)
  IF v_ids IS NOT NULL AND array_length(v_ids, 1) > 0 THEN
    UPDATE agent_memories
    SET updated_at = now()
    WHERE id = ANY(v_ids);

    -- Audit retrieval for promotion engine consumption
    INSERT INTO audit_journal (user_id, action, metadata)
    VALUES (
      auth.uid(),
      'hippocampus.learnings_retrieved',
      jsonb_build_object(
        'memory_ids', to_jsonb(v_ids),
        'story_id', p_story_id,
        'agent_slug', p_agent_slug,
        'limit', p_limit
      )
    );
  END IF;

  RETURN COALESCE(v_results, '[]'::jsonb);
END;
$$;

COMMENT ON FUNCTION public.fn_search_learnings(vector, uuid, text, integer, integer) IS
  'Hippocampus learning: vector search over agent_memories where memory_type=''learning''. '
  'Scoped by story_id (NULL = global learnings only). Score = 0.6*cosine + 0.4*importance. '
  'Touches updated_at for promotion access_count tracking; audits retrieval to audit_journal.';

REVOKE ALL ON FUNCTION public.fn_search_learnings(vector, uuid, text, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_search_learnings(vector, uuid, text, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_search_learnings(vector, uuid, text, integer, integer) TO service_role;
