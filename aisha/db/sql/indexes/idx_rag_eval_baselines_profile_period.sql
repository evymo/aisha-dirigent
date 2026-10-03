-- Index: idx_rag_eval_baselines_profile_period

CREATE INDEX IF NOT EXISTS idx_rag_eval_baselines_profile_period ON public.rag_eval_baselines USING btree (context_profile_slug, period_end DESC);
