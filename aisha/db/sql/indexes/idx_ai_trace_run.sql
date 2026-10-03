-- Index: idx_ai_trace_run

CREATE INDEX idx_ai_trace_run ON public.ai_trace_events USING btree (run_id, created_at);
