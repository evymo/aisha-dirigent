-- Index: idx_agent_memories_expires

CREATE INDEX idx_agent_memories_expires ON public.agent_memories USING btree (expires_at) WHERE (expires_at IS NOT NULL);
