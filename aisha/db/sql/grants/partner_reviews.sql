-- Grants: partner_reviews

GRANT SELECT ON public.partner_reviews TO anon;
GRANT DELETE, INSERT, SELECT, UPDATE ON public.partner_reviews TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.partner_reviews TO service_role;
