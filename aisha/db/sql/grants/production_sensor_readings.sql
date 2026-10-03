-- Grants: production_sensor_readings

GRANT SELECT ON public.production_sensor_readings TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.production_sensor_readings TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.production_sensor_readings TO service_role;
