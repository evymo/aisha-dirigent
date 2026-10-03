-- Index: idx_decision_trees_agent

CREATE INDEX idx_decision_trees_agent ON public.agent_decision_trees USING btree (agent_id);
