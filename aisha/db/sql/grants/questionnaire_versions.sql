-- Grants: questionnaire_versions

GRANT SELECT ON public.questionnaire_versions TO anon;
GRANT DELETE, INSERT, SELECT, UPDATE ON public.questionnaire_versions TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.questionnaire_versions TO service_role;
