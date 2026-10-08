-- Grants: security_event_resolutions

GRANT SELECT ON public.security_event_resolutions TO anon;
GRANT DELETE, INSERT, SELECT, UPDATE ON public.security_event_resolutions TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.security_event_resolutions TO service_role;
