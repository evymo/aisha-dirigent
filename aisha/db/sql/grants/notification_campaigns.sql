-- Grants: notification_campaigns

GRANT SELECT ON public.notification_campaigns TO anon;
GRANT DELETE, INSERT, SELECT, UPDATE ON public.notification_campaigns TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.notification_campaigns TO service_role;
