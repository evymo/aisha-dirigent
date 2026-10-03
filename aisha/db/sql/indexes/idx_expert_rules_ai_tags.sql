-- Index: idx_expert_rules_ai_tags

CREATE INDEX idx_expert_rules_ai_tags ON public.expert_rules USING gin (ai_context_tags);
