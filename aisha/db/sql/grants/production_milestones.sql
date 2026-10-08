-- Grants: production_milestones

GRANT SELECT ON public.production_milestones TO anon;
GRANT DELETE, INSERT, SELECT, UPDATE ON public.production_milestones TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.production_milestones TO service_role;
