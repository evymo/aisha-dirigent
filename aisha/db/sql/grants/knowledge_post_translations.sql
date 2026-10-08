-- Grants: knowledge_post_translations

GRANT SELECT ON public.knowledge_post_translations TO anon;
GRANT DELETE, INSERT, SELECT, UPDATE ON public.knowledge_post_translations TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.knowledge_post_translations TO service_role;
