/**
 * SQL Function: fn_get_memories_without_embeddings
 *
 * Returns agent_memories rows that don't have an embedding yet,
 * ordered by importance (descending). Used by the generate-memory-embeddings
 * edge function to batch-generate OpenAI embeddings.
 *
 * @param p_agent_slug - Optional filter by agent slug
 * @param p_batch_size - Max rows to return (default 50, max 100)
 * @param p_memory_id - Optional: fetch a single memory by ID
 * @returns setof records (id, content, agent_slug, memory_type)
 */
CREATE OR REPLACE FUNCTION public.fn_get_memories_without_embeddings(
  p_agent_slug text DEFAULT NULL,
  p_batch_size integer DEFAULT 50,
  p_memory_id uuid DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  content text,
  agent_slug text,
  memory_type text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Auth check: service_role only (called from edge function)
  IF public.get_jwt_role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required';
  END IF;

  -- Clamp batch size
  IF p_batch_size > 100 THEN
    p_batch_size := 100;
  END IF;

  RETURN QUERY
  SELECT am.id, am.content, am.agent_slug, am.memory_type
  FROM agent_memories am
  WHERE am.embedding IS NULL
    AND (p_memory_id IS NULL OR am.id = p_memory_id)
    AND (p_agent_slug IS NULL OR am.agent_slug = p_agent_slug)
  ORDER BY am.importance DESC
  LIMIT p_batch_size;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_get_memories_without_embeddings(text, integer, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_get_memories_without_embeddings(text, integer, uuid) TO service_role;
