-- Function: mcp_summarize_agent_memories
-- Security: SECURITY DEFINER (bypasses RLS on agent_memories) + caller-scoped p_user_id.
--   2026-07-15 IDOR fix (docs/security/IDOR_P_USER_ID_AUDIT_2026-07-15.md): p_user_id defaults to
--   NULL and every predicate treated a NULL p_user_id as "match every user". Granted to
--   `authenticated`, omitting the argument returned a cross-user census — total count, a breakdown
--   by memory_type, and the top-5 memory CONTENTS (200 chars each, PII) over every user of that
--   agent. Same wildcard defect as mcp_get_agent_memories; fixed the same way, so the two cannot
--   drift apart.

CREATE OR REPLACE FUNCTION public.mcp_summarize_agent_memories(p_agent_slug text, p_user_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_summary jsonb;
  v_total integer;
  v_by_type jsonb;
  v_top_memories jsonb;
  v_user_id uuid;
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
    IF p_user_id IS NOT NULL AND p_user_id <> auth.uid() THEN
      RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
    END IF;
    v_user_id := auth.uid();
  END IF;

  -- Count total active memories
  SELECT count(*) INTO v_total
  FROM agent_memories am
  WHERE am.agent_slug = p_agent_slug
    AND (v_user_id IS NULL OR am.user_id = v_user_id)
    AND (am.expires_at IS NULL OR am.expires_at > now());

  -- Count by type
  SELECT COALESCE(jsonb_object_agg(memory_type, cnt), '{}'::jsonb) INTO v_by_type
  FROM (
    SELECT am.memory_type, count(*) as cnt
    FROM agent_memories am
    WHERE am.agent_slug = p_agent_slug
      AND (v_user_id IS NULL OR am.user_id = v_user_id)
      AND (am.expires_at IS NULL OR am.expires_at > now())
    GROUP BY am.memory_type
  ) sub;

  -- Top 5 by importance
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'memory_type', am.memory_type,
    'content', left(am.content, 200),
    'importance', am.importance
  ) ORDER BY am.importance DESC, am.created_at DESC), '[]'::jsonb)
  INTO v_top_memories
  FROM (
    SELECT am2.memory_type, am2.content, am2.importance, am2.created_at
    FROM agent_memories am2
    WHERE am2.agent_slug = p_agent_slug
      AND (v_user_id IS NULL OR am2.user_id = v_user_id)
      AND (am2.expires_at IS NULL OR am2.expires_at > now())
    ORDER BY am2.importance DESC, am2.created_at DESC
    LIMIT 5
  ) am;

  RETURN jsonb_build_object(
    'status', 'ok',
    'agent_slug', p_agent_slug,
    'total_memories', v_total,
    'by_type', v_by_type,
    'top_memories', v_top_memories
  );
END;
$function$;

REVOKE ALL ON FUNCTION mcp_summarize_agent_memories(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION mcp_summarize_agent_memories(text,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION mcp_summarize_agent_memories(text,uuid) TO service_role;
