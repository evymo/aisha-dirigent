-- Grants: production_equipment_calibrations

GRANT SELECT ON public.production_equipment_calibrations TO anon;
GRANT DELETE, INSERT, SELECT, UPDATE ON public.production_equipment_calibrations TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.production_equipment_calibrations TO service_role;
