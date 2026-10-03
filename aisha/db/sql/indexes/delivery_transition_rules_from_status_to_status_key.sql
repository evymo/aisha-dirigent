-- Index: delivery_transition_rules_from_status_to_status_key

CREATE UNIQUE INDEX delivery_transition_rules_from_status_to_status_key ON public.delivery_transition_rules USING btree (from_status, to_status);
