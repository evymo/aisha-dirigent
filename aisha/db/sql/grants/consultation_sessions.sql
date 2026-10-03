-- Grants: consultation_sessions

GRANT SELECT ON public.consultation_sessions TO anon;
GRANT DELETE, INSERT, SELECT, UPDATE ON public.consultation_sessions TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.consultation_sessions TO service_role;
