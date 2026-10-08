-- Grants: consents

GRANT SELECT ON public.consents TO anon;
GRANT DELETE, INSERT, SELECT, UPDATE ON public.consents TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.consents TO service_role;
