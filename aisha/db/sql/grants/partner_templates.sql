-- Grants: partner_templates

GRANT SELECT ON public.partner_templates TO anon;
GRANT DELETE, INSERT, SELECT, UPDATE ON public.partner_templates TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.partner_templates TO service_role;
