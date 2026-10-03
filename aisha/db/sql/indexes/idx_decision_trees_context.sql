-- Index: idx_decision_trees_context

CREATE INDEX idx_decision_trees_context ON public.agent_decision_trees USING btree (trigger_context);
