-- Index: idx_ai_eval_runs_status

CREATE INDEX idx_ai_eval_runs_status ON public.ai_eval_runs USING btree (status) WHERE (status = ANY (ARRAY['pending'::text, 'running'::text]));
