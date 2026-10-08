-- Grants: operational_assessment_dimensions

GRANT SELECT ON public.operational_assessment_dimensions TO anon;
GRANT DELETE, INSERT, SELECT, UPDATE ON public.operational_assessment_dimensions TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.operational_assessment_dimensions TO service_role;
