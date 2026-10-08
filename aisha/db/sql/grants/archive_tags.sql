-- Grants: archive_tags

GRANT SELECT ON public.archive_tags TO anon;
GRANT DELETE, INSERT, SELECT, UPDATE ON public.archive_tags TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.archive_tags TO service_role;
