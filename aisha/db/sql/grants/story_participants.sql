-- Grants: story_participants

GRANT SELECT ON public.story_participants TO anon;
GRANT DELETE, INSERT, SELECT, UPDATE ON public.story_participants TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.story_participants TO service_role;
