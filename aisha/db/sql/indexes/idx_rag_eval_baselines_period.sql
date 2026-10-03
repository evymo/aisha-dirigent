-- Index: idx_rag_eval_baselines_period

CREATE INDEX IF NOT EXISTS idx_rag_eval_baselines_period ON public.rag_eval_baselines USING btree (period_end DESC);
