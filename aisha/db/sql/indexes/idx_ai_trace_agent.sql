-- Index: idx_ai_trace_agent

CREATE INDEX idx_ai_trace_agent ON public.ai_trace_events USING btree (agent_slug, created_at) WHERE (agent_slug IS NOT NULL);
