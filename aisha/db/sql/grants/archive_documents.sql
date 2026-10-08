-- Grants: archive_documents

GRANT SELECT ON public.archive_documents TO anon;
GRANT DELETE, INSERT, SELECT, UPDATE ON public.archive_documents TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.archive_documents TO service_role;
