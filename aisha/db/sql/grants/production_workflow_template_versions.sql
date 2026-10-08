-- Grants: production_workflow_template_versions

GRANT SELECT ON public.production_workflow_template_versions TO anon;
GRANT DELETE, INSERT, SELECT, UPDATE ON public.production_workflow_template_versions TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.production_workflow_template_versions TO service_role;
