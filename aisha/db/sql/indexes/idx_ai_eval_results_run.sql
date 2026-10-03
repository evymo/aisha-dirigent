-- Index: idx_ai_eval_results_run

CREATE INDEX idx_ai_eval_results_run ON public.ai_eval_results USING btree (eval_run_id);
