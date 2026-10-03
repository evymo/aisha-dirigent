-- mcp_get_agent_knowledge: Retrieve knowledge rules bound to a specific agent
-- Called by: mcp-knowledge-server/index.ts for agent context composition
-- Originally dropped in migration 20260411180000, re-created as needed by MCP server
CREATE OR REPLACE FUNCTION public.mcp_get_agent_knowledge(
  p_agent_slug text,
  p_binding_type text DEFAULT NULL
)
RETURNS TABLE(
  id uuid,
  slug text,
  title text,
  category text,
  body_markdown text,
  ai_instructions text,
  ai_context_tags text[],
  binding_type text,
  priority integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Auth: require an authenticated user OR the service_role. The primary caller
  -- is the MCP knowledge server (svc-mcp-knowledge), which calls via the
  -- service_role token — and a service_role JWT carries no `sub`, so auth.uid()
  -- is NULL for it. Gate on the role too, else the GRANT to service_role below is
  -- dead and every production agent-context lookup fails closed. (Codebase idiom:
  -- current_setting('role', true) — used by ~56 sibling SECURITY DEFINER fns.)
  IF auth.uid() IS NULL AND current_setting('role', true) != 'service_role' THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  RETURN QUERY
  SELECT
    er.id,
    er.slug,
    er.title,
    er.category::text,  -- expert_rules.category is the expert_rule_category enum;
                        -- the function returns text. Without the cast, RETURN QUERY
                        -- raises "structure of query does not match" once rows exist
                        -- (the old er.status='active' filter returned 0 rows, masking it).
    er.body_markdown,
    er.ai_instructions,
    er.ai_context_tags,
    akb.binding_type,
    akb.priority
  FROM agent_knowledge_bindings akb
  JOIN expert_rules er ON er.id = akb.knowledge_item_id
  WHERE akb.agent_slug = p_agent_slug
    AND (p_binding_type IS NULL OR akb.binding_type = p_binding_type)
    AND akb.is_active
    AND akb.story_id IS NULL  -- GLOBAL bindings only: this is the agent-runtime
                              -- context path (materialize writes global rows).
                              -- Per-story bindings (story_id NOT NULL) are private
                              -- to a partner story and must never bleed across
                              -- stories to another caller — see the table comment.
    AND er.status = 'published'  -- expert_rule_status has no 'active'; usable rules are 'published' → the old filter matched 0 rows
  ORDER BY akb.priority DESC, er.title;
END;
$$;

REVOKE ALL ON FUNCTION public.mcp_get_agent_knowledge(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mcp_get_agent_knowledge(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.mcp_get_agent_knowledge(text, text) TO authenticated;
