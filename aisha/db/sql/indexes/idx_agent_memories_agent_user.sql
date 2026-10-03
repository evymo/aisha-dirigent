-- Index: idx_agent_memories_agent_user

CREATE INDEX idx_agent_memories_agent_user ON public.agent_memories USING btree (agent_slug, user_id);
