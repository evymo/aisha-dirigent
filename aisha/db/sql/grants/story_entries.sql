-- Grants: story_entries

GRANT SELECT ON public.story_entries TO anon;
GRANT DELETE, INSERT, SELECT, UPDATE ON public.story_entries TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.story_entries TO service_role;
