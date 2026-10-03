-- Index: idx_rag_eval_runs_batch

CREATE INDEX IF NOT EXISTS idx_rag_eval_runs_batch ON public.rag_eval_runs USING btree (batch_id, created_at DESC);
