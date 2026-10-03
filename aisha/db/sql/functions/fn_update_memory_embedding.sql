/**
 * SQL Function: fn_update_memory_embedding
 *
 * Updates the embedding vector for a single agent_memory row.
 * Used by the generate-memory-embeddings edge function after
 * generating embeddings via OpenAI API.
 *
 * @param p_embedding - JSON string of the embedding vector (1536 dims)
 * @param p_memory_id - The memory row to update
 * @returns jsonb with status
 */
CREATE OR REPLACE FUNCTION public.fn_update_memory_embedding(
  p_embedding text,
  p_memory_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
BEGIN
  -- Auth check: service_role only (called from edge function)
  IF public.get_jwt_role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required';
  END IF;

  -- Validate inputs
  IF p_memory_id IS NULL THEN
    RETURN jsonb_build_object('error', 'p_memory_id is required');
  END IF;
  IF p_embedding IS NULL OR p_embedding = '' THEN
    RETURN jsonb_build_object('error', 'p_embedding is required');
  END IF;

  UPDATE agent_memories
  SET embedding = p_embedding::vector(1024)
  WHERE id = p_memory_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Memory not found', 'memory_id', p_memory_id);
  END IF;

  RETURN jsonb_build_object('status', 'updated', 'memory_id', p_memory_id);
END;
$$;

REVOKE ALL ON FUNCTION public.fn_update_memory_embedding(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_update_memory_embedding(text, uuid) TO service_role;
