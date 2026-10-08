-- Grants: knowledge_topics

GRANT SELECT ON public.knowledge_topics TO anon;
GRANT DELETE, INSERT, SELECT, UPDATE ON public.knowledge_topics TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.knowledge_topics TO service_role;
