-- Grants: production_equipment_cleaning

GRANT SELECT ON public.production_equipment_cleaning TO anon;
GRANT DELETE, INSERT, SELECT, UPDATE ON public.production_equipment_cleaning TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.production_equipment_cleaning TO service_role;
