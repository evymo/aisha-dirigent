-- Grants: partner_availability

GRANT SELECT ON public.partner_availability TO anon;
GRANT DELETE, INSERT, SELECT, UPDATE ON public.partner_availability TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.partner_availability TO service_role;
