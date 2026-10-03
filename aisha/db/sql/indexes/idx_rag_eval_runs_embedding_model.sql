-- Index: idx_rag_eval_runs_embedding_model

CREATE INDEX IF NOT EXISTS idx_rag_eval_runs_embedding_model ON public.rag_eval_runs USING btree (embedding_model, created_at DESC);
