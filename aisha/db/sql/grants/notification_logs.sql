-- Grants: notification_logs

GRANT SELECT ON public.notification_logs TO anon;
GRANT DELETE, INSERT, SELECT, UPDATE ON public.notification_logs TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.notification_logs TO service_role;
