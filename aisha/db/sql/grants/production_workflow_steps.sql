-- Grants: production_workflow_steps

GRANT SELECT ON public.production_workflow_steps TO anon;
GRANT DELETE, INSERT, SELECT, UPDATE ON public.production_workflow_steps TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.production_workflow_steps TO service_role;
