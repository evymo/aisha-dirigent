-- Grants: ai_session_memory

GRANT SELECT ON public.ai_session_memory TO anon;
GRANT DELETE, INSERT, SELECT, UPDATE ON public.ai_session_memory TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.ai_session_memory TO service_role;
