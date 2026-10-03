-- Index: idx_expert_rules_author

CREATE INDEX idx_expert_rules_author ON public.expert_rules USING btree (author_partner_id);
