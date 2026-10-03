-- Function: mcp_store_agent_memory

CREATE OR REPLACE FUNCTION public.mcp_store_agent_memory(p_agent_slug text, p_memory_type text, p_content text, p_importance integer DEFAULT 5, p_user_id uuid DEFAULT NULL::uuid, p_run_id uuid DEFAULT NULL::uuid, p_ttl_hours integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_memory_id uuid;
  v_expires timestamptz;
BEGIN
  -- Authorization: non-elevated callers may only write memories for themselves
  IF NOT (public.is_service_role() OR public.is_admin_or_staff()) THEN
    IF auth.uid() IS NULL THEN
      RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
    END IF;
    IF p_user_id IS NOT NULL AND p_user_id <> auth.uid() THEN
      RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
    END IF;
    p_user_id := auth.uid();
  END IF;

  -- Validate agent exists
  IF NOT EXISTS (SELECT 1 FROM agent_catalog WHERE slug = p_agent_slug AND is_active = true) THEN
    RETURN jsonb_build_object('status', 'error', 'message', 'Agent not found: ' || p_agent_slug);
  END IF;

  -- Calculate expiry
  IF p_ttl_hours IS NOT NULL AND p_ttl_hours > 0 THEN
    v_expires := now() + (p_ttl_hours || ' hours')::interval;
  END IF;

  INSERT INTO agent_memories (agent_slug, user_id, memory_type, content, importance, source_run_id, expires_at)
  VALUES (p_agent_slug, p_user_id, p_memory_type, p_content, p_importance, p_run_id, v_expires)
  RETURNING id INTO v_memory_id;

  RETURN jsonb_build_object(
    'status', 'ok',
    'memory_id', v_memory_id,
    'expires_at', v_expires
  );
END;
$function$;

REVOKE ALL ON FUNCTION mcp_store_agent_memory(text, text, text, integer, uuid, uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION mcp_store_agent_memory(text,text,text,integer,uuid,uuid,integer) TO authenticated;
GRANT EXECUTE ON FUNCTION mcp_store_agent_memory(text,text,text,integer,uuid,uuid,integer) TO service_role;
