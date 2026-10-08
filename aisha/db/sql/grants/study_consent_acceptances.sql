-- Grants: study_consent_acceptances

GRANT SELECT ON public.study_consent_acceptances TO anon;
GRANT DELETE, INSERT, SELECT, UPDATE ON public.study_consent_acceptances TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.study_consent_acceptances TO service_role;
