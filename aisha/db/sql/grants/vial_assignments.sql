-- Grants: vial_assignments

GRANT SELECT ON public.vial_assignments TO anon;
GRANT DELETE, INSERT, SELECT, UPDATE ON public.vial_assignments TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.vial_assignments TO service_role;
