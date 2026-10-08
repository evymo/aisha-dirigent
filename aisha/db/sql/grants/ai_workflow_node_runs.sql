-- Grants: ai_workflow_node_runs

GRANT SELECT ON public.ai_workflow_node_runs TO anon;
GRANT DELETE, INSERT, SELECT, UPDATE ON public.ai_workflow_node_runs TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.ai_workflow_node_runs TO service_role;
