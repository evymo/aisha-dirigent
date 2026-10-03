-- Grants: study_consent_requirements

GRANT SELECT ON public.study_consent_requirements TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.study_consent_requirements TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.study_consent_requirements TO service_role;
