-- Grants: knowledge_embeddings

GRANT SELECT ON public.knowledge_embeddings TO anon;
GRANT DELETE, INSERT, SELECT, UPDATE ON public.knowledge_embeddings TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.knowledge_embeddings TO service_role;
