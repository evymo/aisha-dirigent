-- Grants: product_catalog

GRANT SELECT ON public.product_catalog TO anon;
GRANT DELETE, INSERT, SELECT, UPDATE ON public.product_catalog TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.product_catalog TO service_role;
