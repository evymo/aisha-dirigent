-- Index: idx_ai_proactive_runs_created

CREATE INDEX idx_ai_proactive_runs_created ON public.ai_proactive_runs USING btree (created_at DESC);
