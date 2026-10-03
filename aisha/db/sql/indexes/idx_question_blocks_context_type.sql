-- Index: idx_question_blocks_context_type

CREATE INDEX idx_question_blocks_context_type ON public.question_blocks USING btree (context_type) WHERE (context_type IS NOT NULL);
