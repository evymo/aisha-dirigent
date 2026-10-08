-- Grants: product_access

GRANT SELECT ON public.product_access TO anon;
GRANT DELETE, INSERT, SELECT, UPDATE ON public.product_access TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.product_access TO service_role;
