-- Grants: production_equipment

GRANT SELECT ON public.production_equipment TO anon;
GRANT DELETE, INSERT, SELECT, UPDATE ON public.production_equipment TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.production_equipment TO service_role;
