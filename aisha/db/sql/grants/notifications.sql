-- Grants: notifications

GRANT SELECT ON public.notifications TO anon;
GRANT DELETE, INSERT, SELECT, UPDATE ON public.notifications TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.notifications TO service_role;
