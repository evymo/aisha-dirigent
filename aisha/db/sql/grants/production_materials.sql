-- Grants: production_materials

GRANT SELECT ON public.production_materials TO anon;
GRANT DELETE, INSERT, SELECT, UPDATE ON public.production_materials TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.production_materials TO service_role;
