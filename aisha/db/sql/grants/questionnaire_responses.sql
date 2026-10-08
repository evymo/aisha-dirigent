-- Grants: questionnaire_responses

GRANT SELECT ON public.questionnaire_responses TO anon;
GRANT DELETE, INSERT, SELECT, UPDATE ON public.questionnaire_responses TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.questionnaire_responses TO service_role;
