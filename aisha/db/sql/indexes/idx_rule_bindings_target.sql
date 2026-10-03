-- Index: idx_rule_bindings_target

CREATE INDEX idx_rule_bindings_target ON public.rule_bindings USING btree (target_type, target_id);
