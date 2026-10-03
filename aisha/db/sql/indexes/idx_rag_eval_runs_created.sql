-- Index: idx_rag_eval_runs_created

CREATE INDEX IF NOT EXISTS idx_rag_eval_runs_created ON public.rag_eval_runs USING btree (created_at DESC);
