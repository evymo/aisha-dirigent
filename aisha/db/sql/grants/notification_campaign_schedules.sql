-- Grants: notification_campaign_schedules

GRANT SELECT ON public.notification_campaign_schedules TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.notification_campaign_schedules TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.notification_campaign_schedules TO service_role;
