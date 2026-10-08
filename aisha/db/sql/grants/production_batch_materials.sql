-- Grants: production_batch_materials

GRANT SELECT ON public.production_batch_materials TO anon;
GRANT DELETE, INSERT, SELECT, UPDATE ON public.production_batch_materials TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.production_batch_materials TO service_role;
