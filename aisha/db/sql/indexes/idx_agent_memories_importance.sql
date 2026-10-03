-- Index: idx_agent_memories_importance

CREATE INDEX idx_agent_memories_importance ON public.agent_memories USING btree (importance DESC);
