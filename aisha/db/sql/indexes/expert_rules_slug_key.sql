-- Index: expert_rules_slug_key

CREATE UNIQUE INDEX expert_rules_slug_key ON public.expert_rules USING btree (slug);
