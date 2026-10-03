-- Index: idx_rag_eval_runs_golden

CREATE INDEX IF NOT EXISTS idx_rag_eval_runs_golden ON public.rag_eval_runs USING btree (golden_id, created_at DESC);
