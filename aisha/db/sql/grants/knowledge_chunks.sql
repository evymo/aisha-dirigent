-- Grants: knowledge_chunks

GRANT SELECT ON public.knowledge_chunks TO anon;
GRANT DELETE, INSERT, SELECT, UPDATE ON public.knowledge_chunks TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.knowledge_chunks TO service_role;
