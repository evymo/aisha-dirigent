-- Grants: operational_assessment_tags

GRANT SELECT ON public.operational_assessment_tags TO anon;
GRANT DELETE, INSERT, SELECT, UPDATE ON public.operational_assessment_tags TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.operational_assessment_tags TO service_role;
