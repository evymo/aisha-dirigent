-- Index: idx_rag_eval_golden_profile

CREATE INDEX IF NOT EXISTS idx_rag_eval_golden_profile ON public.rag_eval_golden USING btree (context_profile_slug) WHERE (status = 'active'::text);
