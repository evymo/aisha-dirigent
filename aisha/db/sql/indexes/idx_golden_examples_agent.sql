-- Index: idx_golden_examples_agent

CREATE INDEX idx_golden_examples_agent ON public.ai_golden_examples USING btree (agent_slug);
