-- Index: idx_ai_proactive_runs_status

CREATE INDEX idx_ai_proactive_runs_status ON public.ai_proactive_runs USING btree (status);
