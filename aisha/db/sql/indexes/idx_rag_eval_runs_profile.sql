-- Index: idx_rag_eval_runs_profile

CREATE INDEX IF NOT EXISTS idx_rag_eval_runs_profile ON public.rag_eval_runs USING btree (context_profile_slug, created_at DESC);
