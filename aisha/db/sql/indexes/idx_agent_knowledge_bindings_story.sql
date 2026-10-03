-- Index: idx_agent_knowledge_bindings_story
-- Per-story listing path used by Phase 5 admin matrix.
CREATE INDEX IF NOT EXISTS idx_agent_knowledge_bindings_story
  ON public.agent_knowledge_bindings (story_id)
  WHERE story_id IS NOT NULL AND is_active = true;
