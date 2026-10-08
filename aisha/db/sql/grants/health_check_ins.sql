-- Grants: health_check_ins

GRANT SELECT ON public.health_check_ins TO anon;
GRANT DELETE, INSERT, SELECT, UPDATE ON public.health_check_ins TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.health_check_ins TO service_role;
