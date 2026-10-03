-- Index: idx_agent_memories_learning_source_run
-- Auto-extracted (back-port reconciliation)

CREATE INDEX idx_agent_memories_learning_source_run ON public.agent_memories USING btree (source_run_id) WHERE ((memory_type = 'learning'::text) AND (source_run_id IS NOT NULL));
