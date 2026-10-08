-- Grants: production_sensor_alerts

GRANT SELECT ON public.production_sensor_alerts TO anon;
GRANT DELETE, INSERT, SELECT, UPDATE ON public.production_sensor_alerts TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.production_sensor_alerts TO service_role;
