-- Index: idx_ai_runs_status

CREATE INDEX idx_ai_runs_status ON public.ai_runs USING btree (status) WHERE (status = 'running'::text);
