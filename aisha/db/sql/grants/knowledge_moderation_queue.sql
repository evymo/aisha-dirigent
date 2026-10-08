-- Grants: knowledge_moderation_queue

GRANT SELECT ON public.knowledge_moderation_queue TO anon;
GRANT DELETE, INSERT, SELECT, UPDATE ON public.knowledge_moderation_queue TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.knowledge_moderation_queue TO service_role;
