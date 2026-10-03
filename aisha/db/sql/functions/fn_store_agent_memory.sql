/**
 * SQL Function: fn_store_agent_memory
 *
 * Stores a memory fact for an agent. Used by self-learning workflows
 * to persist learned patterns, integration optimizations, and operational insights.
 *
 * @param p_agent_slug - Agent identifier (e.g., 'dirigent', 'librarian')
 * @param p_memory_type - Type: 'pattern', 'integration', 'preference', 'fact', 'warning'
 * @param p_content - Memory content text
 * @param p_importance - Importance score 1-10 (default 5)
 * @param p_ttl_hours - Time-to-live in hours (NULL = no expiry)
 * @param p_source_run_id - Optional: AI run that produced this memory
 * @returns jsonb with memory_id, status
 */
CREATE OR REPLACE FUNCTION public.fn_store_agent_memory(
  p_agent_slug text,
  p_content text,
  p_importance integer DEFAULT 5,
  p_memory_type text DEFAULT 'fact',
  p_source_run_id uuid DEFAULT NULL,
  p_ttl_hours integer DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_memory_id uuid;
  v_expires_at timestamptz;
  v_user_id uuid;
BEGIN
  -- Auth check: require authenticated user or service_role
  IF auth.uid() IS NULL AND public.get_jwt_role() IS DISTINCT FROM 'service_role' THEN
    RETURN jsonb_build_object('error', 'Authentication required');
  END IF;

  -- Validate agent_slug
  IF p_agent_slug IS NULL OR length(trim(p_agent_slug)) = 0 THEN
    RETURN jsonb_build_object('error', 'agent_slug is required');
  END IF;

  -- Validate memory_type
  IF p_memory_type NOT IN ('pattern', 'integration', 'preference', 'fact', 'warning') THEN
    RETURN jsonb_build_object('error', 'Invalid memory_type. Must be: pattern, integration, preference, fact, warning');
  END IF;

  -- Validate content
  IF p_content IS NULL OR length(trim(p_content)) = 0 THEN
    RETURN jsonb_build_object('error', 'content is required');
  END IF;

  -- Validate importance
  IF p_importance < 1 OR p_importance > 10 THEN
    RETURN jsonb_build_object('error', 'importance must be between 1 and 10');
  END IF;

  -- Calculate expiry
  IF p_ttl_hours IS NOT NULL AND p_ttl_hours > 0 THEN
    v_expires_at := now() + (p_ttl_hours || ' hours')::interval;
  END IF;

  -- Get current user (may be NULL for service-role calls)
  v_user_id := auth.uid();

  -- Insert memory
  INSERT INTO agent_memories (
    agent_slug,
    user_id,
    memory_type,
    content,
    importance,
    source_run_id,
    expires_at
  ) VALUES (
    trim(p_agent_slug),
    v_user_id,
    p_memory_type,
    trim(p_content),
    p_importance,
    p_source_run_id,
    v_expires_at
  )
  RETURNING id INTO v_memory_id;

  RETURN jsonb_build_object(
    'memory_id', v_memory_id,
    'status', 'stored',
    'expires_at', v_expires_at
  );
END;
$$;

-- Permissions: authenticated + service_role only (NO anon access)
REVOKE ALL ON FUNCTION public.fn_store_agent_memory(text, text, integer, text, uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_store_agent_memory(text, text, integer, text, uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_store_agent_memory(text, text, integer, text, uuid, integer) TO service_role;
