-- Grants: partner_profiles_public

GRANT SELECT ON public.partner_profiles_public TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.partner_profiles_public TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.partner_profiles_public TO service_role;
