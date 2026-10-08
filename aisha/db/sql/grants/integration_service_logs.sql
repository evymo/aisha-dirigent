-- Grants: integration_service_logs

GRANT SELECT ON public.integration_service_logs TO anon;
GRANT DELETE, INSERT, SELECT, UPDATE ON public.integration_service_logs TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.integration_service_logs TO service_role;
