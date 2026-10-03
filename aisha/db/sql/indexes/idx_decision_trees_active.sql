-- Index: idx_decision_trees_active

CREATE INDEX idx_decision_trees_active ON public.agent_decision_trees USING btree (is_active);
