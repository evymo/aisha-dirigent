-- Grants: products

GRANT SELECT ON public.products TO anon;
GRANT DELETE, INSERT, SELECT, UPDATE ON public.products TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.products TO service_role;
