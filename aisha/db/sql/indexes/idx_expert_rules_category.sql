-- Index: idx_expert_rules_category

CREATE INDEX idx_expert_rules_category ON public.expert_rules USING btree (category);
