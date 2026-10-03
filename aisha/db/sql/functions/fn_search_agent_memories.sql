-- fn_search_agent_memories: Vector-based semantic search over agent memories
-- Uses hybrid scoring: cosine similarity (60%) + importance weight (40%)
-- Called from ai-context-composer edge function for relevance-ranked memory retrieval.

CREATE OR REPLACE FUNCTION public.fn_search_agent_memories(
  p_query_embedding vector(1024),
  p_agent_slug text,
  p_user_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 10,
  p_min_importance integer DEFAULT 3
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_results jsonb;
  v_user_id uuid;
BEGIN
  -- Resolve the effective scope BEFORE reading. The previous guard asked only "is SOMEONE
  -- authenticated?" while p_user_id defaulted to NULL and NULL meant "match every user"
  -- (2026-07-15 IDOR audit, docs/security/IDOR_P_USER_ID_AUDIT_2026-07-15.md) — so any logged-in
  -- caller could semantically search every user's agent memories (PII) with one embedding.
  -- service_role (the MCP/agent runtimes) and admin/staff keep the cross-user wildcard; everyone
  -- else is pinned to themselves. Memories with am.user_id IS NULL are agent-global, not
  -- user-owned, and stay visible to all — that disjunct is intentional, not part of the defect.
  IF public.is_service_role() OR public.is_admin_or_staff() THEN
    v_user_id := p_user_id;
  ELSE
    IF auth.uid() IS NULL THEN
      RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
    END IF;
    IF p_user_id IS NOT NULL AND p_user_id <> auth.uid() THEN
      RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
    END IF;
    v_user_id := auth.uid();
  END IF;

  -- Validate inputs
  IF p_query_embedding IS NULL THEN
    RAISE EXCEPTION 'p_query_embedding is required';
  END IF;
  IF p_agent_slug IS NULL OR p_agent_slug = '' THEN
    RAISE EXCEPTION 'p_agent_slug is required';
  END IF;

  SELECT COALESCE(jsonb_agg(sub.obj ORDER BY sub.hybrid_score DESC), '[]'::jsonb)
  INTO v_results
  FROM (
    SELECT
      jsonb_build_object(
        'memory_id', am.id,
        'type', am.memory_type,
        'content', am.content,
        'importance', am.importance,
        'cosine_similarity', round((1 - (am.embedding <=> p_query_embedding))::numeric, 4),
        'hybrid_score', round((
          (1 - (am.embedding <=> p_query_embedding)) * 0.6
          + (am.importance / 10.0) * 0.4
        )::numeric, 4),
        'created_at', am.created_at
      ) AS obj,
      (1 - (am.embedding <=> p_query_embedding)) * 0.6
        + (am.importance / 10.0) * 0.4
      AS hybrid_score
    FROM agent_memories am
    WHERE am.agent_slug = p_agent_slug
      AND am.embedding IS NOT NULL
      AND am.importance >= p_min_importance
      AND (am.expires_at IS NULL OR am.expires_at > now())
      AND (v_user_id IS NULL OR am.user_id IS NULL OR am.user_id = v_user_id)
    LIMIT p_limit
  ) sub;

  RETURN jsonb_build_object(
    'memories', v_results,
    'count', jsonb_array_length(v_results),
    'search_method', 'vector_hybrid'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.fn_search_agent_memories(vector(1024), text, uuid, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_search_agent_memories(vector(1024), text, uuid, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_search_agent_memories(vector(1024), text, uuid, integer, integer) TO service_role;
