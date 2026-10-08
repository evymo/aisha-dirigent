-- Grants: consent_templates

GRANT SELECT ON public.consent_templates TO anon;
GRANT DELETE, INSERT, SELECT, UPDATE ON public.consent_templates TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.consent_templates TO service_role;
