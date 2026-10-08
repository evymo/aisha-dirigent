-- Grants: study_test_templates

GRANT SELECT ON public.study_test_templates TO anon;
GRANT DELETE, INSERT, SELECT, UPDATE ON public.study_test_templates TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.study_test_templates TO service_role;
