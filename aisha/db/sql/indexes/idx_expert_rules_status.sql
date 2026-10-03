-- Index: idx_expert_rules_status

CREATE INDEX idx_expert_rules_status ON public.expert_rules USING btree (status);
