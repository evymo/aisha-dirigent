-- Index: idx_ai_workflow_node_runs_run_id

CREATE INDEX idx_ai_workflow_node_runs_run_id ON public.ai_workflow_node_runs USING btree (run_id);
