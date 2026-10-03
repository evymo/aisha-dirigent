-- Index: idx_rag_eval_golden_story

CREATE INDEX IF NOT EXISTS idx_rag_eval_golden_story ON public.rag_eval_golden USING btree (story_id) WHERE (story_id IS NOT NULL);
