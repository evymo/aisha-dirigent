-- Index: idx_expert_rules_slug

CREATE INDEX idx_expert_rules_slug ON public.expert_rules USING btree (slug);
