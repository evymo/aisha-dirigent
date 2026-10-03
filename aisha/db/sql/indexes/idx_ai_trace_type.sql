-- Index: idx_ai_trace_type

CREATE INDEX idx_ai_trace_type ON public.ai_trace_events USING btree (event_type, created_at);
