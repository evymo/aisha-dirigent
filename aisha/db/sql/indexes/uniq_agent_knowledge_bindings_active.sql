-- Index: uniq_agent_knowledge_bindings_active
-- Active binding uniqueness: one active (agent_slug, knowledge_item_id,
-- binding_type, story_id) tuple. NULLS NOT DISTINCT means global rows
-- (story_id IS NULL) participate in uniqueness too, preventing duplicate
-- global bindings.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_agent_knowledge_bindings_active
  ON public.agent_knowledge_bindings (
    agent_slug, knowledge_item_id, binding_type, story_id
  ) NULLS NOT DISTINCT
  WHERE is_active = true;
