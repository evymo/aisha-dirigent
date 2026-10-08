-- Grants: partner_appointments

GRANT SELECT ON public.partner_appointments TO anon;
GRANT DELETE, INSERT, SELECT, UPDATE ON public.partner_appointments TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.partner_appointments TO service_role;
