-- Index: idx_agent_knowledge_bindings_lookup
-- mcp_get_agent_knowledge query path: WHERE agent_slug = ? AND binding_type = ?
CREATE INDEX IF NOT EXISTS idx_agent_knowledge_bindings_lookup
  ON public.agent_knowledge_bindings (agent_slug, binding_type)
  WHERE is_active = true;
