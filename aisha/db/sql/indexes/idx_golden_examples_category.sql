-- Index: idx_golden_examples_category

CREATE INDEX idx_golden_examples_category ON public.ai_golden_examples USING btree (routing_category);
