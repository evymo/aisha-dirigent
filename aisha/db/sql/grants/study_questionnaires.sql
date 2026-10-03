-- Grants: study_questionnaires

GRANT SELECT ON public.study_questionnaires TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.study_questionnaires TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.study_questionnaires TO service_role;
