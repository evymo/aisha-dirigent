-- Index: idx_ai_workflow_node_runs_node_type

CREATE INDEX idx_ai_workflow_node_runs_node_type ON public.ai_workflow_node_runs USING btree (node_type);
