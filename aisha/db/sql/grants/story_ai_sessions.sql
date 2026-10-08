-- Grants: story_ai_sessions

GRANT SELECT ON public.story_ai_sessions TO anon;
GRANT DELETE, INSERT, SELECT, UPDATE ON public.story_ai_sessions TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.story_ai_sessions TO service_role;
