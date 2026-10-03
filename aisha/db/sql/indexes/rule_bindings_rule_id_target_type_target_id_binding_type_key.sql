-- Index: rule_bindings_rule_id_target_type_target_id_binding_type_key

CREATE UNIQUE INDEX rule_bindings_rule_id_target_type_target_id_binding_type_key ON public.rule_bindings USING btree (rule_id, target_type, target_id, binding_type);
