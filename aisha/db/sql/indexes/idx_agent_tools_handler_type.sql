-- Index: idx_agent_tools_handler_type

CREATE INDEX idx_agent_tools_handler_type ON public.agent_tools USING btree (handler_type);
