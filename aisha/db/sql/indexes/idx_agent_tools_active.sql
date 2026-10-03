-- Index: idx_agent_tools_active

CREATE INDEX idx_agent_tools_active ON public.agent_tools USING btree (is_active) WHERE (is_active = true);
