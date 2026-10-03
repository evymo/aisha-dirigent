-- Index: idx_expert_rules_expertise_area

CREATE INDEX idx_expert_rules_expertise_area ON public.expert_rules USING btree (expertise_area_id);
