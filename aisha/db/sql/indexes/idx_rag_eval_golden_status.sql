-- Index: idx_rag_eval_golden_status

CREATE INDEX IF NOT EXISTS idx_rag_eval_golden_status ON public.rag_eval_golden USING btree (status) WHERE (status = 'active'::text);
