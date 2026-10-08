-- Grants: questionnaire_blocks

GRANT SELECT ON public.questionnaire_blocks TO anon;
GRANT DELETE, INSERT, SELECT, UPDATE ON public.questionnaire_blocks TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.questionnaire_blocks TO service_role;
