-- Index: idx_rule_bindings_rule

CREATE INDEX idx_rule_bindings_rule ON public.rule_bindings USING btree (rule_id);
