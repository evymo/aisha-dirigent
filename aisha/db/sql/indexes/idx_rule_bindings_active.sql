-- Index: idx_rule_bindings_active

CREATE INDEX idx_rule_bindings_active ON public.rule_bindings USING btree (is_active) WHERE (is_active = true);
