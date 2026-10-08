-- Grants: featured_products

GRANT SELECT ON public.featured_products TO anon;
GRANT DELETE, INSERT, SELECT, UPDATE ON public.featured_products TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.featured_products TO service_role;
