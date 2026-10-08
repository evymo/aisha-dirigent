-- Grants: partner_matching_profiles

GRANT SELECT ON public.partner_matching_profiles TO anon;
GRANT DELETE, INSERT, SELECT, UPDATE ON public.partner_matching_profiles TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.partner_matching_profiles TO service_role;
