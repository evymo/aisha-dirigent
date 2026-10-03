-- Index: idx_golden_examples_active

CREATE INDEX idx_golden_examples_active ON public.ai_golden_examples USING btree (is_active);
