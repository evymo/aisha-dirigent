-- Grants: data_sharing_consents

GRANT SELECT ON public.data_sharing_consents TO anon;
GRANT DELETE, INSERT, SELECT, UPDATE ON public.data_sharing_consents TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.data_sharing_consents TO service_role;
