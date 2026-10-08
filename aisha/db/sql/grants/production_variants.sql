-- Grants: production_variants

GRANT SELECT ON public.production_variants TO anon;
GRANT DELETE, INSERT, SELECT, UPDATE ON public.production_variants TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.production_variants TO service_role;
