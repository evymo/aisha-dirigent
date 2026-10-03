-- Grants: health_data_sync_log

GRANT SELECT ON public.health_data_sync_log TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.health_data_sync_log TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.health_data_sync_log TO service_role;
