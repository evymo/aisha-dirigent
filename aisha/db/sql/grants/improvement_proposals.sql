-- Grants: improvement_proposals

GRANT SELECT ON public.improvement_proposals TO anon;
GRANT DELETE, INSERT, SELECT, UPDATE ON public.improvement_proposals TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.improvement_proposals TO service_role;
