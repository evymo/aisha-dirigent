-- Function: mcp_get_agent_memories
-- Retrieves filtered agent memories (by slug, user, type, importance) for MCP tool access.
-- Respects expiry dates; returns JSONB with status, count, and memory array.
-- Security: SECURITY DEFINER (so it bypasses RLS on agent_memories) + caller-scoped p_user_id.
--   2026-07-15 IDOR fix (docs/security/IDOR_P_USER_ID_AUDIT_2026-07-15.md): p_user_id defaults to
--   NULL and the predicate was `p_user_id IS NULL OR am.user_id = p_user_id` — so NULL meant ALL
--   USERS. With the `authenticated` grant, OMITTING the argument dumped every user's agent
--   memories (agent_memories.content is conversation memory, i.e. PII) to any logged-in caller:
--   POST /rest/v1/rpc/mcp_get_agent_memories {"p_agent_slug":"..."}. Not a targeted IDOR — a bulk
--   read, and the most damaging shape of this class, because the attacker needs no victim id.
--   The wildcard is legitimate for trusted callers, so it is not removed: it is now resolved from
--   the caller's identity, and only service_role/admin may still request it.

CREATE OR REPLACE FUNCTION public.mcp_get_agent_memories(p_agent_slug text, p_user_id uuid DEFAULT NULL::uuid, p_memory_type text DEFAULT NULL::text, p_min_importance integer DEFAULT 1, p_limit integer DEFAULT 20)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_memories jsonb;
  v_user_id  uuid;
BEGIN
  -- Resolve the effective scope BEFORE reading. service_role (the MCP/agent runtimes) and
  -- admin/staff keep the cross-user wildcard; everyone else is pinned to themselves, so a
  -- NULL p_user_id collapses to "my memories" instead of "everyone's".
  IF public.is_service_role() OR public.is_admin_or_staff() THEN
    v_user_id := p_user_id;
  ELSE
    IF auth.uid() IS NULL THEN
      RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
    END IF;
    -- Asking for someone else is a deliberate probe: refuse rather than silently self-scope,
    -- so the caller learns its request was denied instead of trusting a wrong answer.
    IF p_user_id IS NOT NULL AND p_user_id <> auth.uid() THEN
      RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
    END IF;
    v_user_id := auth.uid();
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', am.id,
    'memory_type', am.memory_type,
    'content', am.content,
    'importance', am.importance,
    'created_at', am.created_at,
    'expires_at', am.expires_at
  ) ORDER BY am.importance DESC, am.created_at DESC), '[]'::jsonb)
  INTO v_memories
  FROM agent_memories am
  WHERE am.agent_slug = p_agent_slug
    AND (v_user_id IS NULL OR am.user_id = v_user_id)
    AND (p_memory_type IS NULL OR am.memory_type = p_memory_type)
    AND am.importance >= p_min_importance
    AND (am.expires_at IS NULL OR am.expires_at > now());

  RETURN jsonb_build_object(
    'status', 'ok',
    'agent_slug', p_agent_slug,
    'count', jsonb_array_length(v_memories),
    'memories', v_memories
  );
END;
$function$;

REVOKE ALL ON FUNCTION mcp_get_agent_memories(text, uuid, text, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION mcp_get_agent_memories(text,uuid,text,integer,integer) TO authenticated;
GRANT EXECUTE ON FUNCTION mcp_get_agent_memories(text,uuid,text,integer,integer) TO service_role;
