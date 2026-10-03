-- Index: idx_agent_memories_learning_type_agent
-- Auto-extracted (back-port reconciliation)

CREATE INDEX idx_agent_memories_learning_type_agent ON public.agent_memories USING btree (agent_slug, memory_type, importance DESC, created_at DESC) WHERE (memory_type = 'learning'::text);
