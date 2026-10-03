-- Grants: personality_signals

GRANT SELECT ON public.personality_signals TO anon;
GRANT DELETE, INSERT, SELECT, UPDATE ON public.personality_signals TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.personality_signals TO service_role;
