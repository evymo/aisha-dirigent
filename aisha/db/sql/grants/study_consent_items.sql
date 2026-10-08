-- Grants: study_consent_items

GRANT SELECT ON public.study_consent_items TO anon;
GRANT DELETE, INSERT, SELECT, UPDATE ON public.study_consent_items TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.study_consent_items TO service_role;
