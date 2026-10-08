-- Grants: product_access_rules

GRANT SELECT ON public.product_access_rules TO anon;
GRANT DELETE, INSERT, SELECT, UPDATE ON public.product_access_rules TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.product_access_rules TO service_role;
