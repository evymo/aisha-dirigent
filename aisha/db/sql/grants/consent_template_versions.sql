-- Grants: consent_template_versions

GRANT SELECT ON public.consent_template_versions TO anon;
GRANT DELETE, INSERT, SELECT, UPDATE ON public.consent_template_versions TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.consent_template_versions TO service_role;
