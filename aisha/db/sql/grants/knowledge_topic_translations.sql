-- Grants: knowledge_topic_translations

GRANT SELECT ON public.knowledge_topic_translations TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.knowledge_topic_translations TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.knowledge_topic_translations TO service_role;
