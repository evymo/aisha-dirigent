-- Index: expert_rule_ratings_rule_id_user_id_key

CREATE UNIQUE INDEX expert_rule_ratings_rule_id_user_id_key ON public.expert_rule_ratings USING btree (rule_id, user_id);
