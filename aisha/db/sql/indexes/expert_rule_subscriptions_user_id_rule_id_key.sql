-- Index: expert_rule_subscriptions_user_id_rule_id_key

CREATE UNIQUE INDEX expert_rule_subscriptions_user_id_rule_id_key ON public.expert_rule_subscriptions USING btree (user_id, rule_id);
