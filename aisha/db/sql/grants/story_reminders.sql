-- Grants: story_reminders

GRANT SELECT ON public.story_reminders TO anon;
GRANT DELETE, INSERT, SELECT, UPDATE ON public.story_reminders TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.story_reminders TO service_role;
