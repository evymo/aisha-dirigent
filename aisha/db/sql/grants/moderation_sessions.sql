-- Grants: moderation_sessions

GRANT SELECT ON public.moderation_sessions TO anon;
GRANT DELETE, INSERT, SELECT, UPDATE ON public.moderation_sessions TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.moderation_sessions TO service_role;
